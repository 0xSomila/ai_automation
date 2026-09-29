/**
 * Google Calendar backend: the reference implementation of BookingBackend.
 *
 * Availability comes from freebusy. Every call is wrapped and logged, with a
 * clean failure that the caller turns into a customer-facing message.
 *
 * See BUILD.md section 4 (booking backend) and CLAUDE.md (every external call wrapped).
 */
import {
  registerBackend,
  type BookingBackend,
  type BookingMeta,
  type BookingWindow,
  type CommittedBooking,
} from "./adapter.js";
import type { BusyInterval, EngagementDraft } from "./primitive.js";
import { endsAt } from "./primitive.js";

export interface GoogleCalendarConfig {
  calendarId: string;
  /** JSON string of the service account credentials, from env. */
  serviceAccountJson: string;
}

class GoogleCalendarBackend implements BookingBackend {
  constructor(private readonly config: GoogleCalendarConfig) {}

  async getBusy(window: BookingWindow): Promise<BusyInterval[]> {
    // TODO(build): call calendar.freebusy.query with the service account client.
    // Return busy intervals mapped to { startsAt, endsAt, resource }.
    // Reference client = one calendar; per-staff models map staff -> calendarId.
    void this.config;
    void window;
    throw new Error("GoogleCalendarBackend.getBusy not yet implemented");
  }

  async create(
    draft: Required<EngagementDraft>,
    meta: BookingMeta,
  ): Promise<CommittedBooking> {
    // TODO(build): calendar.events.insert. Store the returned event id.
    void endsAt;
    void draft;
    void meta;
    throw new Error("GoogleCalendarBackend.create not yet implemented");
  }

  async reschedule(
    backendEventId: string,
    newStartsAt: Date,
    meta: BookingMeta,
  ): Promise<void> {
    void backendEventId;
    void newStartsAt;
    void meta;
    throw new Error("GoogleCalendarBackend.reschedule not yet implemented");
  }

  async cancel(backendEventId: string): Promise<void> {
    void backendEventId;
    throw new Error("GoogleCalendarBackend.cancel not yet implemented");
  }
}

registerBackend("google_calendar", (config) => {
  return new GoogleCalendarBackend(config as GoogleCalendarConfig);
});
