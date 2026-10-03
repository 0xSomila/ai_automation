// A busy block on the practice calendar, ISO 8601 start and end.
export interface BusyBlock {
  start: string;
  end: string;
}

// The one interface every booking backend implements. Swap the
// implementation per client (Google Calendar, a practice-management
// system, an in-memory dev stub) without touching the brain or tools.
export interface BookingBackend {
  getBusy(dateISO: string): Promise<BusyBlock[]>;
  createEvent(input: {
    service: string;
    name: string;
    startISO: string;
    durationMin: number;
  }): Promise<{ eventId: string }>;
  cancelEvent(eventId: string): Promise<void>;
}
