import type { Config, DayKey } from "../config/types";
import type { BusyBlock } from "./adapter";

const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function weekdayKey(dateISO: string): DayKey {
  // Anchor at noon to avoid timezone date-flips. Server is assumed to run
  // in the practice timezone; see CLAUDE.md for the production note.
  const d = new Date(`${dateISO}T12:00:00`);
  return DAY_KEYS[d.getDay()];
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
  const dayStart = new Date(`${dateISO}T00:00:00`);
  if (dayStart > horizon) return [];

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
    const slotStart = new Date(`${dateISO}T${time}:00`);
    if (slotStart < earliest) continue;
    const t = slotStart.getTime();
    const covered = busyRanges.some(([bs, be]) => t >= bs && t < be);
    if (!covered) slots.push(time);
  }
  return slots;
}
