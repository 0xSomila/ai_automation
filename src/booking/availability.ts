import type { Config, DayKey } from "../config/types";
import type { BusyBlock } from "./adapter";
import type { ReservationLoad } from "../db/types";
import { practiceTime } from "./time";

const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function weekdayKey(dateISO: string): DayKey {
  const d = new Date(`${dateISO}T12:00:00Z`);
  return DAY_KEYS[d.getUTCDay()];
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Open slot start times (HH:MM) for one date, given the config hours and the
 * backend's busy blocks. Grid is config.booking.slotStepMin. A slot is open
 * when no busy block covers it and it clears the lead time and the horizon.
 */
export function computeOpenSlots(
  config: Config,
  dateISO: string,
  busy: BusyBlock[],
  now: Date = new Date(),
): string[] {
  const hours = config.hours[weekdayKey(dateISO)];
  if (!hours) return []; // closed that day

  const horizon = new Date(now.getTime() + config.booking.maxDaysAhead * 864e5);
  const timeZone = config.practice.timezone;
  const dayStart = practiceTime(dateISO, "00:00", timeZone);
  if (!Number.isFinite(dayStart) || dayStart > horizon.getTime()) return [];

  const earliest = new Date(now.getTime() + config.booking.leadTimeHours * 36e5);
  const [open, close] = hours;
  const step = config.booking.slotStepMin;

  const busyRanges = busy.map((b) => [
    new Date(b.start).getTime(),
    new Date(b.end).getTime(),
  ]);

  const slots: string[] = [];
  for (let m = toMinutes(open); m + step <= toMinutes(close); m += step) {
    const time = fromMinutes(m);
    const t = practiceTime(dateISO, time, timeZone);
    if (!Number.isFinite(t) || t < earliest.getTime()) continue;
    const covered = busyRanges.some(([bs, be]) => t >= bs && t < be);
    if (!covered) slots.push(time);
  }
  return slots;
}

/**
 * Covers resource model (restaurant). Open slot times for a date where the
 * remaining seats (capacity minus the covers already reserved at that time) are
 * enough for the requested party. Availability comes from reservations, not the
 * calendar. See BUILD.md section 5 and the restaurant pack.
 */
export function computeCoversSlots(
  config: Config,
  dateISO: string,
  reservations: ReservationLoad[],
  party: number,
  now: Date = new Date(),
): string[] {
  const hours = config.hours[weekdayKey(dateISO)];
  const capacity = config.capacity ?? 0;
  if (!hours || capacity <= 0) return [];

  const horizon = new Date(now.getTime() + config.booking.maxDaysAhead * 864e5);
  if (new Date(`${dateISO}T00:00:00`) > horizon) return [];
  const earliest = new Date(now.getTime() + config.booking.leadTimeHours * 36e5);

  const [open, close] = hours;
  const step = config.booking.slotStepMin;

  // Pre-compute each reservation's [start, end) in ms with its party load.
  const loads = reservations.map((r) => {
    const start = new Date(r.startsAt).getTime();
    const dur = (r.durationMin ?? step) * 60000;
    return { start, end: start + dur, party: r.party };
  });

  const slots: string[] = [];
  for (let m = toMinutes(open); m + step <= toMinutes(close); m += step) {
    const time = fromMinutes(m);
    const slotStart = new Date(`${dateISO}T${time}:00`);
    if (slotStart < earliest) continue;
    const t = slotStart.getTime();
    const consumed = loads.reduce((sum, l) => (t >= l.start && t < l.end ? sum + l.party : sum), 0);
    if (capacity - consumed >= party) slots.push(time);
  }
  return slots;
}
