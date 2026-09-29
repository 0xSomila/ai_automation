/**
 * The booking backend adapter interface.
 *
 * Each client's real system (Google Calendar, a practice-management system, a
 * reservations tool) plugs in behind this. The brain and the tool executors
 * only ever talk to a BookingBackend, never to a specific vendor.
 *
 * See BUILD.md sections 3 and 5.
 */
import type { BusyInterval, EngagementDraft } from "./primitive.js";

export interface BookingWindow {
  from: Date;
  to: Date;
  /** Optional resource filter (a staff member, a table). */
  resource?: string;
}

export interface CommittedBooking {
  /** The vendor's own id for the event, stored as backend_event_id. */
  backendEventId: string;
}

export interface BookingBackend {
  /** Live busy intervals for a window. The source of truth for availability. */
  getBusy(window: BookingWindow): Promise<BusyInterval[]>;

  /** Commit a booking. Caller has already re-validated the slot. */
  create(draft: Required<EngagementDraft>, meta: BookingMeta): Promise<CommittedBooking>;

  /** Move an existing booking. */
  reschedule(backendEventId: string, newStartsAt: Date, meta: BookingMeta): Promise<void>;

  /** Cancel an existing booking. */
  cancel(backendEventId: string): Promise<void>;
}

export interface BookingMeta {
  businessSlug: string;
  customerName?: string;
  customerPhone: string;
  notes?: string;
}

/** Registry of backend factories, keyed by config `booking.backend`. */
const registry = new Map<string, (config: unknown) => BookingBackend>();

export function registerBackend(
  name: string,
  factory: (config: unknown) => BookingBackend,
): void {
  registry.set(name, factory);
}

export function makeBackend(name: string, config: unknown): BookingBackend {
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(`No booking backend registered for "${name}"`);
  }
  return factory(config);
}
