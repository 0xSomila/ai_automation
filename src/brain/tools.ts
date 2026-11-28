import type { Anthropic } from "@anthropic-ai/sdk";
import type { Config } from "../config/types.js";
import type { BookingBackend } from "../booking/adapter.js";
import type { Engagement, Store } from "../db/types.js";
import type { Pack } from "./pack.js";
import { computeOpenSlots, computeCoversSlots, dayStatus, bookableDatesAfter, type DayReason } from "../booking/availability.js";
import { practiceTime } from "../booking/time.js";

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
      "Returns the open times for one date. Call before offering or confirming any times. Pass the service so the whole session fits. For a restaurant, pass the party size. Returns the open HH:MM list. When a date has no times it returns a reason and the next days that do have times: offer only those, never invent times.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date as YYYY-MM-DD" },
        weekday: { type: "string", description: "The weekday the customer named, if any (e.g. Monday). The date must fall on it." },
        service: { type: "string", description: "Service the customer wants, so its length is respected" },
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
        weekday: { type: "string", description: "The weekday the customer named, if any (e.g. Monday). The date must fall on it." },
        time: { type: "string", description: "HH:MM" },
        party: { type: "integer", description: "Party size, for table reservations" },
      },
      required: ["name", "date", "time"],
    },
  },
  reschedule_appointment: {
    name: "reschedule_appointment",
    description:
      "Moves the customer's appointment to a selected new open date and time. Use the reference from the customer's booking lookup if available. With no reference, proceeds only if the customer has one upcoming booking.",
    input_schema: {
      type: "object",
      properties: {
        reference: { type: "string", description: "The booking reference, e.g. C7-AB12" },
        date: { type: "string", description: "New date YYYY-MM-DD" },
        weekday: { type: "string", description: "The weekday the customer named, if any (e.g. Monday). The date must fall on it." },
        time: { type: "string", description: "New time HH:MM" },
      },
      required: ["date", "time"],
    },
  },
  cancel_appointment: {
    name: "cancel_appointment",
    description:
      "Cancels the customer's appointment after a clear cancellation request. Use the reference from the customer's booking lookup if available. With no reference, proceeds only if the customer has one upcoming booking.",
    input_schema: {
      type: "object",
      properties: { reference: { type: "string", description: "The booking reference" } },
    },
  },
  list_upcoming_bookings: {
    name: "list_upcoming_bookings",
    description: "Finds upcoming appointments for the sender of this chat. Use for booking questions and for cancellation or postponement requests without a reference. The sender never needs to supply a reference to use this tool.",
    input_schema: { type: "object", properties: {} },
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

// Plain-language cause for an empty day, so the model never has to guess "booked".
const REASON_NOTE: Record<DayReason, string> = {
  open: "",
  closed: "The practice is closed that day. Offer one of nextAvailable.",
  beyond_horizon: "That date is further ahead than bookings are taken. Offer one of nextAvailable.",
  past_cutoff:
    "It is too late to book that day: the remaining times have passed or fall inside the required notice. This is not a fully booked day. Offer one of nextAvailable.",
  fully_booked: "Every time that day is taken. Offer one of nextAvailable.",
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_NAME = WEEKDAYS.map((d) => d[0].toUpperCase() + d.slice(1));

function dayIndex(dateISO: string): number {
  const t = Date.parse(`${dateISO}T12:00:00Z`);
  return Number.isFinite(t) ? new Date(t).getUTCDay() : -1;
}

function weekdayIndex(raw: unknown): number {
  const w = String(raw ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return -1;
  return WEEKDAYS.findIndex((d) => d === w || d.startsWith(w));
}

function dateLabel(dateISO: string): string {
  const i = dayIndex(dateISO);
  const d = new Date(`${dateISO}T12:00:00Z`);
  const month = new Intl.DateTimeFormat("en-ZA", { timeZone: "UTC", day: "numeric", month: "long" }).format(d);
  return i < 0 ? dateISO : `${WEEKDAY_NAME[i]} ${month}`;
}

/**
 * The model names a weekday and a date; they must agree. Returns a ready tool result when they
 * do not (with the real upcoming dates for that weekday), or null when fine or no weekday given.
 */
function weekdayMismatch(dateISO: string, weekday: unknown, timeZone: string, now: Date = new Date()): string | null {
  const want = weekdayIndex(weekday);
  if (want < 0) return null;
  const actual = dayIndex(dateISO);
  if (actual < 0 || actual === want) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  const upcoming: string[] = [];
  for (let i = 0; i < 15 && upcoming.length < 2; i++) {
    const d = new Date(Date.parse(`${today}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10);
    if (dayIndex(d) === want) upcoming.push(d);
  }
  return JSON.stringify({
    status: "date_mismatch",
    date: dateISO,
    message: `${dateISO} is a ${WEEKDAY_NAME[actual]} (${dateLabel(dateISO)}), not a ${WEEKDAY_NAME[want]}. Tell the customer, then ask which they mean. Upcoming ${WEEKDAY_NAME[want]} dates: ${upcoming.map((d) => `${dateLabel(d)} (${d})`).join(", ")}.`,
    upcoming,
  });
}

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

// Bookings are stored as UTC instants. The model must never convert them: it read a 12:00
// Johannesburg booking as "10:00" (the UTC clock time). Hand it the practice's local day,
// date and time instead, and no raw instant to misread.
function describeBooking(booking: Engagement, timeZone: string) {
  const start = booking.startsAt ? new Date(booking.startsAt) : null;
  const local = start && Number.isFinite(start.getTime())
    ? {
        day: new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(start),
        date: new Intl.DateTimeFormat("en-CA", { timeZone }).format(start),
        time: new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(start),
      }
    : {};
  return { reference: booking.reference, service: booking.service, ...local, durationMin: booking.durationMin };
}

async function findBooking(ctx: ToolCtx, reference: string): Promise<Engagement | string> {
  if (reference) {
    const booking = await ctx.store.findEngagementByReference(ctx.businessId, reference);
    if (booking?.customerId === ctx.customerId && booking.status === "confirmed") return booking;
  } else {
    const bookings = await ctx.store.upcomingBookings(ctx.businessId, ctx.customerId, new Date().toISOString());
    if (bookings.length === 1) return bookings[0];
    if (bookings.length > 1) {
      return JSON.stringify({ status: "needs_selection", timeZone: ctx.config.practice.timezone, bookings: bookings.map((b) => describeBooking(b, ctx.config.practice.timezone)) });
    }
  }
  return JSON.stringify({ status: "not_found", message: "No matching active booking for this customer." });
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
  const timeZone = ctx.config.practice.timezone;

  if (name === "list_upcoming_bookings") {
    const bookings = await ctx.store.upcomingBookings(ctx.businessId, ctx.customerId, new Date().toISOString());
    return JSON.stringify({ timeZone, bookings: bookings.map((b) => describeBooking(b, timeZone)) });
  }

  if (name === "check_availability") {
    const date = String(input.date ?? "").trim();
    const party = toParty(input.party);
    const mismatch = weekdayMismatch(date, input.weekday, timeZone);
    if (mismatch) return mismatch;

    if (isCovers) {
      const open = computeCoversSlots(ctx.config, date, await ctx.store.reservationsOn(ctx.businessId, date), party);
      if (open.length === 0) {
        return JSON.stringify({
          date,
          party,
          open: [],
          note: "No tables for that party that day. Offer another day or the waitlist.",
        });
      }
      return JSON.stringify({ date, party, open });
    }

    const durationMin = resolveService(ctx, String(input.service ?? ""))?.durationMin;
    const now = new Date();
    const status = dayStatus(ctx.config, date, await ctx.backend.getBusy(date, timeZone), now, durationMin);
    if (status.open.length > 0) return JSON.stringify({ date, day: dateLabel(date), open: status.open });

    // Empty day: say why, and look ahead so the model offers real times, not guesses.
    const nextAvailable: { date: string; open: string[] }[] = [];
    const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
    const from = date > today ? date : today;
    const candidates = from === date ? bookableDatesAfter(ctx.config, date, now) : [from, ...bookableDatesAfter(ctx.config, from, now)];
    for (const d of candidates.slice(0, 10)) {
      if (d === date) continue;
      const day = dayStatus(ctx.config, d, await ctx.backend.getBusy(d, timeZone), now, durationMin);
      if (day.open.length > 0) nextAvailable.push({ date: d, open: day.open.slice(0, 6) });
      if (nextAvailable.length >= 3) break;
    }
    return JSON.stringify({ date, day: dateLabel(date), open: [], reason: status.reason, note: REASON_NOTE[status.reason], nextAvailable });
  }

  if (name === "book_appointment") {
    const date = String(input.date ?? "").trim();
    const time = String(input.time ?? "").trim();
    const name_ = String(input.name ?? "").trim();
    const service = String(input.service ?? "").trim();
    const party = toParty(input.party);
    const mismatch = weekdayMismatch(date, input.weekday, timeZone);
    if (mismatch) return mismatch;

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
        bookingName: name_,
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
    const svc = resolveService(ctx, service);
    const durationMin = svc?.durationMin ?? ctx.config.booking.slotStepMin;
    const busy = await ctx.backend.getBusy(date, timeZone);
    const open = computeOpenSlots(ctx.config, date, busy, new Date(), durationMin);
    if (!open.includes(time)) {
      return JSON.stringify({
        status: "unavailable",
        message: "That time is not open. Call check_availability and offer a listed time.",
      });
    }

    const startISO = new Date(practiceTime(date, time, timeZone)).toISOString();
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
      bookingName: name_,
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
    const reference = String(input.reference ?? "").trim().toUpperCase();
    const date = String(input.date ?? "").trim();
    const time = String(input.time ?? "").trim();
    const mismatch = weekdayMismatch(date, input.weekday, timeZone);
    if (mismatch) return mismatch;

    const eng = await findBooking(ctx, reference);
    if (typeof eng === "string") return eng;
    const durationMin =
      eng.durationMin ?? resolveService(ctx, eng.service ?? "")?.durationMin ?? ctx.config.booking.slotStepMin;
    const start = practiceTime(date, time, timeZone);
    if (start === Date.parse(eng.startsAt ?? "")) {
      return JSON.stringify({ status: "unchanged", reference: eng.reference, service: eng.service, date, time });
    }

    // Re-validate the new slot against live availability. Never trust the model.
    // The booking being moved must not block itself, so drop its own calendar block.
    const ownStart = Date.parse(eng.startsAt ?? "");
    const ownEnd = ownStart + durationMin * 60000;
    const busy = (await ctx.backend.getBusy(date, timeZone)).filter(
      (b) => !(Date.parse(b.start) === ownStart && Date.parse(b.end) === ownEnd),
    );
    const open = computeOpenSlots(ctx.config, date, busy, new Date(), durationMin);
    if (!open.includes(time)) {
      return JSON.stringify({
        status: "unavailable",
        message: "That new time is not open. Call check_availability and offer a listed time.",
      });
    }

    const startISO = new Date(start).toISOString();

    const canMove = eng.backendEventId && eng.startsAt;
    const eventId = canMove
      ? eng.backendEventId!
      : (await ctx.backend.createEvent({ service: eng.service ?? "appointment", name: "", startISO, durationMin })).eventId;
    if (canMove) await ctx.backend.moveEvent(eventId, startISO, durationMin);
    try {
      await ctx.store.updateEngagement(eng.id, {
        startsAt: startISO,
        durationMin,
        backendEventId: eventId,
        reminderSentAt: undefined,
        followupSentAt: undefined,
      });
    } catch (error) {
      if (canMove) await ctx.backend.moveEvent(eventId, eng.startsAt!, durationMin);
      else await ctx.backend.cancelEvent(eventId);
      throw error;
    }
    return JSON.stringify({ status: "confirmed", reference: eng.reference, service: eng.service, date, time });
  }

  if (name === "cancel_appointment") {
    const reference = String(input.reference ?? "").trim().toUpperCase();
    const eng = await findBooking(ctx, reference);
    if (typeof eng === "string") return eng;
    if (eng.backendEventId) await ctx.backend.cancelEvent(eng.backendEventId);
    await ctx.store.updateEngagement(eng.id, { status: "cancelled" });
    // The freed slot is offered to the waitlist by the waitlist job (within ~15 min).
    return JSON.stringify({ status: "cancelled", reference: eng.reference, service: eng.service, startsAt: eng.startsAt });
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
