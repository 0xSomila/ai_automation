import { readFileSync } from "node:fs";
import { google } from "googleapis";
import type { BookingBackend, BusyBlock } from "./adapter";
import { practiceDay } from "./time";

export interface GoogleCalendarOptions {
  calendarId?: string;
  timeZone?: string;
}

// Production booking backend. Defaults to the env calendar and TZ; pass options
// per client when wiring multiple calendars (one Google Calendar per client).
export class GoogleCalendarBackend implements BookingBackend {
  private calendar;
  private calendarId: string;
  private timeZone: string;

  constructor(opts: GoogleCalendarOptions = {}) {
    const inlineKey = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const calendarId = opts.calendarId ?? process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) throw new Error("Set GOOGLE_CALENDAR_ID to the booking calendar ID.");
    if (!inlineKey && !keyFile) {
      throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_JSON for Google Calendar.");
    }

    // Parse errors can include part of the JSON. Keep credential contents out of logs.
    let creds;
    try {
      creds = JSON.parse(inlineKey || readFileSync(keyFile!, "utf8"));
    } catch {
      throw new Error("Could not read Google Calendar service account JSON. Check the file path or JSON format.");
    }
    if (typeof creds?.client_email !== "string" || typeof creds?.private_key !== "string") {
      throw new Error("Google Calendar credentials must contain the service account email and private key.");
    }
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.events.freebusy",
      ],
    });
    this.calendar = google.calendar({ version: "v3", auth });
    this.calendarId = calendarId;
    this.timeZone = opts.timeZone ?? process.env.TZ ?? "Africa/Johannesburg";
  }

  async getBusy(dateISO: string, timeZone = this.timeZone): Promise<BusyBlock[]> {
    const [start, end] = practiceDay(dateISO, timeZone);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    const timeMin = new Date(start).toISOString();
    const timeMax = new Date(end).toISOString();
    const res = await this.calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        timeZone,
        items: [{ id: this.calendarId }],
      },
    });
    const calendar = res.data.calendars?.[this.calendarId];
    if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) {
      const reasons = calendar?.errors?.map(({ reason }) => reason).filter(Boolean).join(", ");
      throw new Error(`Google Calendar did not return booking availability${reasons ? ` (${reasons})` : ""}. Check the calendar ID and sharing permissions.`);
    }
    return calendar.busy.map(({ start, end }) => {
      if (!start || !end) throw new Error("Google Calendar returned an incomplete busy interval.");
      return { start, end };
    });
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
        start: { dateTime: start.toISOString(), timeZone: this.timeZone },
        end: { dateTime: end.toISOString(), timeZone: this.timeZone },
      },
    });
    return { eventId: res.data.id! };
  }

  async moveEvent(eventId: string, startISO: string, durationMin: number): Promise<void> {
    const end = new Date(Date.parse(startISO) + durationMin * 60_000);
    await this.calendar.events.patch({
      calendarId: this.calendarId,
      eventId,
      requestBody: {
        start: { dateTime: startISO, timeZone: this.timeZone },
        end: { dateTime: end.toISOString(), timeZone: this.timeZone },
      },
    });
  }

  async cancelEvent(eventId: string): Promise<void> {
    if (this.calendarId === process.env.MERIDIAN_RETENTION_CALENDAR_ID) {
      await this.eraseEvent(eventId);
      return;
    }
    try {
      await this.calendar.events.delete({ calendarId: this.calendarId, eventId });
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status !== 404 && status !== 410) throw error;
    }
  }

  async eraseEvent(eventId: string): Promise<void> {
    try {
      // Google Calendar can retain deleted events in Trash. Clear the booking title first.
      await this.calendar.events.patch({
        calendarId: this.calendarId,
        eventId,
        sendUpdates: "none",
        requestBody: { summary: "Expired pilot appointment", description: "", location: "" },
      });
      await this.calendar.events.delete({ calendarId: this.calendarId, eventId, sendUpdates: "none" });
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status !== 404 && status !== 410) throw error;
    }
  }
}
