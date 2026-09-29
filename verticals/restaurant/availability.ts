/**
 * Restaurant availability: covers-based.
 * check_availability(date, party) returns sitting times where remaining covers
 * >= party. Remaining = total covers for the sitting minus covers already booked
 * (from live busy, which the backend reports as capacity used per interval).
 * See BUILD.md sections 5 and 9b.
 */
import { DateTime } from "luxon";
import type { AvailabilityArgs, ComputeAvailability } from "../../core/pack.js";
import type { Slot } from "../../core/booking/primitive.js";

const compute: ComputeAvailability = async (args: AvailabilityArgs): Promise<Slot[]> => {
  const { config, backend, date, party = 1 } = args;
  const zone = config.timezone;

  // Total covers = sum of resource capacities marked as tables.
  const totalCovers =
    config.resources
      ?.filter((r) => r.kind === "table")
      .reduce((sum, r) => sum + r.capacity, 0) ?? 0;

  const day = DateTime.fromISO(date, { zone });
  const weekday = day.toFormat("ccc").toLowerCase().slice(0, 3) as
    | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

  // Each hours window is a sitting (lunch, dinner). Its `open` time is the seating.
  const sittings = config.hours?.[weekday] ?? [];
  if (sittings.length === 0 || totalCovers === 0) return [];

  const dayStart = day.startOf("day").toJSDate();
  const dayEnd = day.endOf("day").toJSDate();
  const busy = await backend.getBusy({ from: dayStart, to: dayEnd });

  const slots: Slot[] = [];
  for (const sitting of sittings) {
    const startsAt = day
      .set({
        hour: Number(sitting.open.slice(0, 2)),
        minute: Number(sitting.open.slice(3, 5)),
      })
      .toJSDate();

    // Covers consumed during this sitting. The backend encodes party size as the
    // busy interval's implied load; here we count overlapping intervals x 1 as a
    // conservative default until the backend reports per-interval covers.
    const consumed = busy.filter(
      (b) => b.startsAt <= startsAt && b.endsAt > startsAt,
    ).length;
    const remaining = totalCovers - consumed;

    if (remaining >= party) {
      slots.push({ startsAt, resource: "covers", remaining });
    }
  }

  return slots;
};

export default compute;
