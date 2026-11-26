import assert from "node:assert/strict";
import { GoogleCalendarBackend } from "../src/booking/googleCalendar.js";

// Exercise the event requests without credentials or external writes.
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "fixture@example.invalid", private_key: "fixture" });
process.env.GOOGLE_CALENDAR_ID = "fixture";
process.env.TZ = ":UTC";
delete process.env.GOOGLE_CALENDAR_TIMEZONE;
const backend = new GoogleCalendarBackend();
const requests: any[] = [];
(backend as any).calendar = { events: {
  insert: async (request: unknown) => { requests.push(request); return { data: { id: "fixture-event" } }; },
  patch: async (request: unknown) => { requests.push(request); return {}; },
} };
assert.deepEqual(await backend.createEvent({ service: "Test", name: "Fictional Patient", startISO: "2026-11-27T08:00:00Z", durationMin: 45 }), { eventId: "fixture-event" });
await backend.moveEvent("fixture-event", "2026-11-27T12:00:00Z", 45);
for (const request of requests) {
  assert.equal(request.requestBody.start.timeZone, "Africa/Johannesburg", "host TZ must not leak into Calendar requests");
  assert.equal(request.requestBody.end.timeZone, "Africa/Johannesburg");
  assert.equal(Date.parse(request.requestBody.end.dateTime) - Date.parse(request.requestBody.start.dateTime), 45 * 60_000);
}
console.log("Calendar create and move preserve instants and practice timezone when host TZ is POSIX.");
