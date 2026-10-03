import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config/types";
import type { BookingBackend } from "../booking/adapter";
import type { Store } from "../db/types";
import { computeOpenSlots } from "../booking/availability";

export interface ToolCtx {
  config: Config;
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
      "Returns the open appointment times for one date. Call before offering or confirming any times. Returns the open HH:MM list, or a note if closed or full.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "Date as YYYY-MM-DD" } },
      required: ["date"],
    },
  },
  book_appointment: {
    name: "book_appointment",
    description:
      "Books an appointment after you have the customer name, service, date and an open time. Returns a confirmation reference, or an unavailable status if the time was taken.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        service: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:MM" },
      },
      required: ["name", "service", "date", "time"],
    },
  },
};

export function toolDefs(toolNames: string[]): Anthropic.Tool[] {
  return toolNames.map((n) => ALL_TOOLS[n]).filter(Boolean);
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolCtx,
): Promise<string> {
  if (name === "check_availability") {
    const date = String(input.date ?? "").trim();
    const busy = await ctx.backend.getBusy(date);
    const open = computeOpenSlots(ctx.config, date, busy);
    if (open.length === 0) {
      return JSON.stringify({
        date,
        open: [],
        note: "Closed or fully booked that day. Offer another day.",
      });
    }
    return JSON.stringify({ date, open });
  }

  if (name === "book_appointment") {
    const date = String(input.date ?? "").trim();
    const time = String(input.time ?? "").trim();
    const name_ = String(input.name ?? "").trim();
    const service = String(input.service ?? "").trim();

    // Re-validate against live availability. Never trust the model.
    const busy = await ctx.backend.getBusy(date);
    const open = computeOpenSlots(ctx.config, date, busy);
    if (!open.includes(time)) {
      return JSON.stringify({
        status: "unavailable",
        message: "That time is not open. Call check_availability and offer a listed time.",
      });
    }

    const svc =
      ctx.config.services.find((s) => s.name.toLowerCase() === service.toLowerCase()) ??
      ctx.config.services.find((s) =>
        service.toLowerCase().includes(s.name.toLowerCase().split(" ")[0]),
      );
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

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}
