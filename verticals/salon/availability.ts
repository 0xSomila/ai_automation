/**
 * Salon availability: per staff.
 * check_availability(date, service, staff?) returns open times across the staff
 * qualified for the service, or for the chosen staff. Each staff member is a
 * resource with capacity 1. See BUILD.md sections 5 and 9c.
 */
import { DateTime } from "luxon";
import type { AvailabilityArgs, ComputeAvailability } from "../../core/pack.js";
import type { Slot } from "../../core/booking/primitive.js";
import { overlaps } from "../../core/booking/primitive.js";

const SLOT_STEP_MIN = 15;

const compute: ComputeAvailability = async (args: AvailabilityArgs): Promise<Slot[]> => {
  const { config, backend, date, service, staff } = args;
  const zone = config.timezone;

  const svc = config.services?.find((s) => s.name === service);
  const durationMin = svc?.durationMin ?? 30;

  // Which staff can perform this service.
  let qualified = svc?.staff ?? config.resources?.filter((r) => r.kind === "staff").map((r) => r.name) ?? [];
  if (staff) qualified = qualified.filter((name) => name === staff);
  if (qualified.length === 0) return [];

  const day = DateTime.fromISO(date, { zone });
  const weekday = day.toFormat("ccc").toLowerCase().slice(0, 3) as
    | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  const windows = config.hours?.[weekday] ?? [];
  if (windows.length === 0) return [];

  const dayStart = day.startOf("day").toJSDate();
  const dayEnd = day.endOf("day").toJSDate();

  const slots: Slot[] = [];
  for (const staffName of qualified) {
    const busy = await backend.getBusy({ from: dayStart, to: dayEnd, resource: staffName });

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
          slots.push({ startsAt, resource: staffName, remaining: 1 });
        }
        cursor = cursor.plus({ minutes: SLOT_STEP_MIN });
      }
    }
  }

  // Soonest first, so "any staff" naturally offers the earliest opening.
  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return slots;
};

export default compute;
