import { google } from "googleapis";
import type { BookingBackend, BusyBlock } from "./adapter";

// Production booking backend. One Google Calendar per client.
export class GoogleCalendarBackend implements BookingBackend {
  private calendar;
  private calendarId: string;

  constructor() {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    this.calendar = google.calendar({ version: "v3", auth });
    this.calendarId = process.env.GOOGLE_CALENDAR_ID!;
  }

  async getBusy(dateISO: string): Promise<BusyBlock[]> {
    const timeMin = new Date(`${dateISO}T00:00:00`).toISOString();
    const timeMax = new Date(`${dateISO}T23:59:59`).toISOString();
    const res = await this.calendar.freebusy.query({
      requestBody: { timeMin, timeMax, items: [{ id: this.calendarId }] },
    });
    const busy = res.data.calendars?.[this.calendarId]?.busy ?? [];
    return busy.map((b) => ({ start: b.start!, end: b.end! }));
  }

  async createEvent(input: {
    service: string;
    name: string;
    startISO: string;
    durationMin: number;
  }): Promise<{ eventId: string }> {
    const start = new Date(input.startISO);
    const end = new Date(start.getTime() + input.durationMin * 60000);
    const res = await this.calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: {
        summary: `${input.service} - ${input.name}`,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      },
    });
    return { eventId: res.data.id! };
  }

  async cancelEvent(eventId: string): Promise<void> {
    await this.calendar.events.delete({ calendarId: this.calendarId, eventId });
  }
}
