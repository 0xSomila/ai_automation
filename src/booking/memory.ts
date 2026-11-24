import type { BookingBackend, BusyBlock } from "./adapter.js";
import { practiceDay } from "./time.js";

// In-memory calendar for dev and the chat harness. Starts fully open;
// each booking adds a busy block so repeat calls see the slot taken.
export class MemoryBackend implements BookingBackend {
  private busy = new Map<string, BusyBlock>();
  private seq = 0;

  async getBusy(dateISO: string, timeZone = "UTC"): Promise<BusyBlock[]> {
    const [start, end] = practiceDay(dateISO, timeZone);
    return [...this.busy.values()].filter((block) => Date.parse(block.start) < end && Date.parse(block.end) > start);
  }

  async createEvent(input: {
    service: string;
    name: string;
    startISO: string;
    durationMin: number;
  }): Promise<{ eventId: string }> {
    const eventId = `mem-${++this.seq}`;
    await this.moveEvent(eventId, input.startISO, input.durationMin);
    return { eventId };
  }

  async moveEvent(eventId: string, startISO: string, durationMin: number): Promise<void> {
    const end = new Date(Date.parse(startISO) + durationMin * 60_000);
    this.busy.set(eventId, { start: startISO, end: end.toISOString() });
  }

  async cancelEvent(eventId: string): Promise<void> {
    this.busy.delete(eventId);
  }
}
