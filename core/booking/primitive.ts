/**
 * The one booking primitive. Appointments AND reservations are the same shape.
 * Do not add a parallel model. If a vertical needs something new, extend this.
 *
 * See BUILD.md section 5.
 */

/** What a vertical's resource model can be. */
export type ResourceKind = "single" | "per_staff" | "covers";

/**
 * An Engagement is what gets booked: a practitioner's slot, a table for six,
 * a stylist and a chair. One relational shape, vertical differences in the fields.
 */
export interface Engagement {
  /** What is being consumed: a practitioner, a table, a stylist. */
  resource: string;
  /** How much: 1 slot, or covers/seats for a party. */
  capacity: number;
  /** Minutes the resource is held. */
  duration: number;
  /** The time, always stored UTC. */
  startsAt: Date;
  /** People count where it matters (restaurant, group class). Defaults to 1. */
  party: number;
  /** The named thing sold: a service, a menu sitting, a treatment. */
  service: string;
}

export type EngagementKind =
  | "appointment"
  | "reservation"
  | "order"
  | "lead";

/** A single open time returned by check_availability. */
export interface Slot {
  /** Start of the slot, UTC. */
  startsAt: Date;
  /** The resource this slot is against (a staff name, a table id, "default"). */
  resource: string;
  /** Remaining capacity at this slot (covers left, or 1 for single-slot models). */
  remaining: number;
}

/** Live busy data the backend adapter returns for a window. */
export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
  resource: string;
}

/**
 * A draft engagement the brain proposes. The executor re-validates it against
 * live availability before writing. Never trust these fields blindly.
 */
export interface EngagementDraft {
  service: string;
  startsAt: Date;
  duration: number;
  party: number;
  resource?: string;
}

export function endsAt(e: Pick<Engagement, "startsAt" | "duration">): Date {
  return new Date(e.startsAt.getTime() + e.duration * 60_000);
}

export function overlaps(a: BusyInterval, startsAt: Date, duration: number): boolean {
  const end = new Date(startsAt.getTime() + duration * 60_000);
  return a.startsAt < end && startsAt < a.endsAt;
}
