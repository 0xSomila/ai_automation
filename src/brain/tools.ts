import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config/types";
import type { BookingBackend } from "../booking/adapter";
import type { Store } from "../db/types";
import type { Pack } from "./pack";
import { computeOpenSlots, computeCoversSlots } from "../booking/availability";

export interface ToolCtx {
  config: Config;
  pack: Pack;
  backend: BookingBackend;
  store: Store;
  businessId: string;
  customerId: string;
}

// Every tool the Core knows. A pack lists which it uses in pack.json.
const ALL_TOOLS: Record<string, Anthropic.Tool> = {
  check_availability: {
    name: "check_availability",
    description:
      "Returns the open times for one date. Call before offering or confirming any times. For a restaurant, pass the party size. Returns the open HH:MM list, or a note if closed or full.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date as YYYY-MM-DD" },
        party: { type: "integer", description: "Party size, for table reservations" },
      },
      required: ["date"],
    },
  },
  book_appointment: {
    name: "book_appointment",
    description:
      "Books an appointment or table after you have the customer name, the date and an open time (and the party size for a restaurant). Returns a confirmation reference, or an unavailable status if the time was taken.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        service: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:MM" },
        party: { type: "integer", description: "Party size, for table reservations" },
      },
      required: ["name", "date", "time"],
    },
  },
  reschedule_appointment: {
    name: "reschedule_appointment",
    description:
      "Moves an existing appointment to a new open time. Needs the booking reference and the new date and time. Re-validates the new time first. Returns the updated booking or an unavailable status.",
    input_schema: {
      type: "object",
      properties: {
        reference: { type: "string", description: "The booking reference, e.g. C7-AB12" },
        date: { type: "string", description: "New date YYYY-MM-DD" },
        time: { type: "string", description: "New time HH:MM" },
      },
      required: ["reference", "date", "time"],
    },
  },
  cancel_appointment: {
    name: "cancel_appointment",
    description:
      "Cancels an existing appointment by its booking reference. Returns a cancelled status, or not_found if the reference is unknown.",
    input_schema: {
      type: "object",
      properties: { reference: { type: "string", description: "The booking reference" } },
      required: ["reference"],
    },
  },
  join_waitlist: {
    name: "join_waitlist",
    description:
      "Adds the customer to the waitlist for a date when it is full. Needs their name and the date they want. They are messaged if a space opens.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        service: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["name", "date"],
    },
  },
};

function toParty(raw: unknown): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function resolveService(ctx: ToolCtx, service: string) {
  return (
    ctx.config.services.find((s) => s.name.toLowerCase() === service.toLowerCase()) ??
    ctx.config.services.find((s) =>
      service.toLowerCase().includes(s.name.toLowerCase().split(" ")[0]),
    )
  );
}

export function toolDefs(toolNames: string[]): Anthropic.Tool[] {
  return toolNames.map((n) => ALL_TOOLS[n]).filter(Boolean);
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolCtx,
): Promise<string> {
  const isCovers = ctx.pack.resourceModel.kind === "covers";

  if (name === "check_availability") {
    const date = String(input.date ?? "").trim();
    const party = toParty(input.party);

    const open = isCovers
      ? computeCoversSlots(ctx.config, date, await ctx.store.reservationsOn(ctx.businessId, date), party)
      : computeOpenSlots(ctx.config, date, await ctx.backend.getBusy(date));

    if (open.length === 0) {
      return JSON.stringify({
        date,
        party,
        open: [],
        note: isCovers
          ? "No tables for that party that day. Offer another day or the waitlist."
          : "Closed or fully booked that day. Offer another day.",
      });
    }
    return JSON.stringify({ date, party, open });
  }

  if (name === "book_appointment") {
    const date = String(input.date ?? "").trim();
    const time = String(input.time ?? "").trim();
    const name_ = String(input.name ?? "").trim();
    const service = String(input.service ?? "").trim();
    const party = toParty(input.party);

    if (isCovers) {
      const limit = ctx.config.partySizeLimit;
      if (limit && party > limit) {
        return JSON.stringify({
          status: "party_too_large",
          message: `Parties over ${limit} are handled as an event enquiry. Capture the details for the team.`,
        });
      }
      // Re-validate covers for this party against live reservations.
      const reservations = await ctx.store.reservationsOn(ctx.businessId, date);
      const open = computeCoversSlots(ctx.config, date, reservations, party);
      if (!open.includes(time)) {
        return JSON.stringify({
          status: "unavailable",
          message: "That time has no table for this party. Call check_availability and offer a listed time.",
        });
      }
      const durationMin = resolveService(ctx, service)?.durationMin ?? ctx.config.booking.slotStepMin;
      const reference = "C7-" + Math.random().toString(36).slice(2, 6).toUpperCase();
      await ctx.store.createEngagement({
        businessId: ctx.businessId,
        customerId: ctx.customerId,
        kind: "reservation",
        service: service || undefined,
        resource: "table",
        party,
        startsAt: `${date}T${time}:00`,
        durationMin,
        status: "confirmed",
        reference,
      });
      return JSON.stringify({ status: "confirmed", reference, name: name_, party, date, time });
    }

    // Single / per-staff: calendar-backed slot booking.
    const busy = await ctx.backend.getBusy(date);
    const open = computeOpenSlots(ctx.config, date, busy);
    if (!open.includes(time)) {
      return JSON.stringify({
        status: "unavailable",
        message: "That time is not open. Call check_availability and offer a listed time.",
      });
    }

    const svc = resolveService(ctx, service);
    const durationMin = svc?.durationMin ?? ctx.config.booking.slotStepMin;

    const startISO = `${date}T${time}:00`;
    const { eventId } = await ctx.backend.createEvent({
      service,
      name: name_,
      startISO,
      durationMin,
    });
    const reference = "C7-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    await ctx.store.createEngagement({
      businessId: ctx.businessId,
      customerId: ctx.customerId,
      kind: "appointment",
      service,
      startsAt: startISO,
      durationMin,
      status: "confirmed",
      reference,
      backendEventId: eventId,
    });
    return JSON.stringify({ status: "confirmed", reference, name: name_, service, date, time });
  }

  if (name === "reschedule_appointment") {
    const reference = String(input.reference ?? "").trim();
    const date = String(input.date ?? "").trim();
    const time = String(input.time ?? "").trim();

    const eng = await ctx.store.findEngagementByReference(ctx.businessId, reference);
    if (!eng || eng.status === "cancelled") {
      return JSON.stringify({ status: "not_found", message: "No active booking for that reference." });
    }

    // Re-validate the new slot against live availability. Never trust the model.
    const busy = await ctx.backend.getBusy(date);
    const open = computeOpenSlots(ctx.config, date, busy);
    if (!open.includes(time)) {
      return JSON.stringify({
        status: "unavailable",
        message: "That new time is not open. Call check_availability and offer a listed time.",
      });
    }

    const durationMin =
      eng.durationMin ?? resolveService(ctx, eng.service ?? "")?.durationMin ?? ctx.config.booking.slotStepMin;
    const startISO = `${date}T${time}:00`;

    // Book the new slot, then release the old one, then update the record.
    const { eventId } = await ctx.backend.createEvent({
      service: eng.service ?? "appointment",
      name: "",
      startISO,
      durationMin,
    });
    if (eng.backendEventId) {
      try {
        await ctx.backend.cancelEvent(eng.backendEventId);
      } catch (e) {
        console.error("reschedule: failed to cancel old event", (e as Error).message);
      }
    }
    await ctx.store.updateEngagement(eng.id, {
      startsAt: startISO,
      durationMin,
      backendEventId: eventId,
      reminderSentAt: undefined, // a moved booking earns a fresh reminder
    });
    return JSON.stringify({ status: "confirmed", reference, service: eng.service, date, time });
  }

  if (name === "cancel_appointment") {
    const reference = String(input.reference ?? "").trim();
    const eng = await ctx.store.findEngagementByReference(ctx.businessId, reference);
    if (!eng || eng.status === "cancelled") {
      return JSON.stringify({ status: "not_found", message: "No active booking for that reference." });
    }
    if (eng.backendEventId) {
      try {
        await ctx.backend.cancelEvent(eng.backendEventId);
      } catch (e) {
        console.error("cancel: failed to cancel event", (e as Error).message);
      }
    }
    await ctx.store.updateEngagement(eng.id, { status: "cancelled" });
    // The freed slot is offered to the waitlist by the waitlist job (within ~15 min).
    return JSON.stringify({ status: "cancelled", reference });
  }

  if (name === "join_waitlist") {
    const date = String(input.date ?? "").trim();
    const name_ = String(input.name ?? "").trim();
    const service = String(input.service ?? "").trim();
    const reference = "C7-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    await ctx.store.createEngagement({
      businessId: ctx.businessId,
      customerId: ctx.customerId,
      kind: "appointment",
      service: service || undefined,
      startsAt: `${date}T00:00:00`, // date preference; no specific time until a slot opens
      status: "waitlist",
      reference,
    });
    return JSON.stringify({ status: "waitlisted", reference, name: name_, date });
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}
