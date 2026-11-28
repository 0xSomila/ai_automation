import assert from "node:assert/strict";
import { MemoryStore } from "../src/db/memory.js";
import { MemoryBackend } from "../src/booking/memory.js";
import { loadConfig } from "../src/config/load.js";
import { loadPack } from "../src/brain/pack.js";
import { buildSystemPrompt, renderCalendar } from "../src/brain/systemPrompt.js";
import { executeTool, type ToolCtx } from "../src/brain/tools.js";

// Regression for the Sat 28 Nov chat where the model said "Monday 2 December" and then
// accepted the customer's "Monday is 1st of December", booking a Tuesday. Weekdays are
// now read from a calendar in the prompt, and the tools reject a weekday/date mismatch.
//   npm run test:dates

const config = loadConfig("meridian");
const pack = loadPack("practitioner");
const saturday = new Date("2026-11-28T08:00:00Z"); // Sat 28 Nov 10:00 SAST

// 1. The prompt carries a calendar the model can read, with the right weekdays.
const prompt = buildSystemPrompt(config, pack, saturday);
assert.match(prompt, /Today, .*28 November \(2026-11-28\)/);
assert.match(prompt, /Monday,? 30 November \(2026-11-30\)/);
assert.match(prompt, /Tuesday,? 0?1 December \(2026-12-01\)/);
assert.match(prompt, /Wednesday,? 0?2 December \(2026-12-02\)/);
assert.equal(renderCalendar("Africa/Johannesburg", saturday).split("\n").length, 14);
assert.match(prompt, /never work out a date yourself/);
assert.match(prompt, /do not go along with it/);

// 2. The calendar follows the practice time zone, not UTC (Sat 23:30 UTC is already Sunday in SAST).
const lateSat = new Date("2026-11-28T23:30:00Z");
assert.match(renderCalendar("Africa/Johannesburg", lateSat), /Today, Sunday,? 29 November \(2026-11-29\)/);

async function main(): Promise<void> {
  const store = new MemoryStore();
  const backend = new MemoryBackend();
  const customer = await store.getOrCreateCustomer("meridian", "+27820005555");
  const ctx: ToolCtx = { config, pack, backend, store, businessId: "meridian", customerId: customer.id };
  const call = async (tool: string, input: Record<string, unknown>) => JSON.parse(await executeTool(tool, input, ctx));

  // Monday 30 Nov at least a few days out is relative to the real clock, so use dates by weekday instead.
  const upcoming = (weekdayIdx: number, minDays: number): string => {
    const d = new Date(Date.now() + minDays * 864e5);
    while (d.getUTCDay() !== weekdayIdx) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const monday = upcoming(1, 2);
  const tuesday = upcoming(2, 2);

  // 3. check_availability: a Tuesday date presented as "Monday" is rejected with the real Mondays.
  const bad = await call("check_availability", { date: tuesday, weekday: "Monday", service: "Sports massage" });
  assert.equal(bad.status, "date_mismatch");
  assert.ok(bad.upcoming.length >= 1 && bad.upcoming.every((d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 1));
  assert.match(bad.message, /Tuesday/);
  assert.ok(!("open" in bad), "no times are offered for a mismatched date");

  // 4. Matching weekday (full name, short name, any case) is accepted and the result names the day.
  for (const w of ["Monday", "mon", "MONDAY", "Mon."]) {
    const ok = await call("check_availability", { date: monday, weekday: w, service: "Sports massage" });
    assert.ok(Array.isArray(ok.open) && ok.open.length > 0, `accepted ${w}`);
    assert.match(ok.day, /^Monday/);
  }

  // 5. Omitting the weekday still works, and an unrecognised weekday word is ignored, not fatal.
  assert.ok((await call("check_availability", { date: monday })).open.length > 0);
  assert.ok((await call("check_availability", { date: monday, weekday: "weekend" })).open.length > 0);

  // 6. book_appointment refuses to book a mismatched date, and nothing lands on the calendar.
  const refused = await call("book_appointment", { name: "Mpho Test", service: "Sports massage", date: tuesday, weekday: "Monday", time: "12:00" });
  assert.equal(refused.status, "date_mismatch");
  assert.equal((await backend.getBusy(tuesday, "Africa/Johannesburg")).length, 0, "no booking was made");

  // 7. The same request with the right date books.
  const booked = await call("book_appointment", { name: "Mpho Test", service: "Sports massage", date: monday, weekday: "Monday", time: "12:00" });
  assert.equal(booked.status, "confirmed");

  // 8. Reschedule has the same gate.
  const moved = await call("reschedule_appointment", { reference: booked.reference, date: tuesday, weekday: "Monday", time: "13:00" });
  assert.equal(moved.status, "date_mismatch");

  console.log("dates: all checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
