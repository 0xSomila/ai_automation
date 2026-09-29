/**
 * Practitioner availability: single resource, capacity 1.
 * Open slots = candidate slots from the day's hours, minus live busy intervals,
 * sized to the service duration. See BUILD.md sections 5 and 9a.
 */
import { DateTime } from "luxon";
import type { AvailabilityArgs, ComputeAvailability } from "../../core/pack.js";
import type { Slot } from "../../core/booking/primitive.js";
import { overlaps } from "../../core/booking/primitive.js";

const SLOT_STEP_MIN = 15;

const compute: ComputeAvailability = async (args: AvailabilityArgs): Promise<Slot[]> => {
  const { config, backend, date, service } = args;
  const zone = config.timezone;

  const durationMin =
    config.services?.find((s) => s.name === service)?.durationMin ?? 30;

  const day = DateTime.fromISO(date, { zone });
  const weekday = day.toFormat("ccc").toLowerCase().slice(0, 3) as
    | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

  const windows = config.hours?.[weekday] ?? [];
  if (windows.length === 0) return [];

  const dayStart = day.startOf("day").toJSDate();
  const dayEnd = day.endOf("day").toJSDate();
  const busy = await backend.getBusy({ from: dayStart, to: dayEnd });

  const slots: Slot[] = [];
  for (const w of windows) {
    let cursor = day.set({
      hour: Number(w.open.slice(0, 2)),
      minute: Number(w.open.slice(3, 5)),
    });
    const close = day.set({
      hour: Number(w.close.slice(0, 2)),
      minute: Number(w.close.slice(3, 5)),
    });

    while (cursor.plus({ minutes: durationMin }) <= close) {
      const startsAt = cursor.toJSDate();
      const clash = busy.some((b) => overlaps(b, startsAt, durationMin));
      if (!clash) {
        slots.push({ startsAt, resource: "default", remaining: 1 });
      }
      cursor = cursor.plus({ minutes: SLOT_STEP_MIN });
    }
  }

  return slots;
};

export default compute;
