import type { BookingBackend, BusyBlock } from "./adapter";

// In-memory calendar for dev and the chat harness. Starts fully open;
// each booking adds a busy block so repeat calls see the slot taken.
export class MemoryBackend implements BookingBackend {
  private busy: BusyBlock[] = [];
  private seq = 0;

  async getBusy(dateISO: string): Promise<BusyBlock[]> {
    return this.busy.filter((b) => b.start.startsWith(dateISO));
  }

  async createEvent(input: {
    service: string;
    name: string;
    startISO: string;
    durationMin: number;
  }): Promise<{ eventId: string }> {
    const start = new Date(input.startISO);
    const end = new Date(start.getTime() + input.durationMin * 60000);
    this.busy.push({ start: start.toISOString(), end: end.toISOString() });
    return { eventId: `mem-${++this.seq}` };
  }

  async cancelEvent(eventId: string): Promise<void> {
    // Dev stub: nothing to reverse precisely; left intentionally simple.
    void eventId;
  }
}
