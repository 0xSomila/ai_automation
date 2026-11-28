import "dotenv/config";
import assert from "node:assert";
import { MemoryStore } from "../src/db/memory";
import { MemoryBackend } from "../src/booking/memory";
import { loadConfig } from "../src/config/load";
import { loadPack } from "../src/brain/pack";
import { computeOpenSlots, dayStatus } from "../src/booking/availability";
import { executeTool, type ToolCtx } from "../src/brain/tools";

// Regression: an empty day must say why, never just "fully booked", and a slot
// must fit the whole service. Pure functions use a pinned clock; no Claude API.
//   npm run test:availability

const config = loadConfig("meridian");
// Sat 28 Nov 2026 09:51 SAST: the moment the receptionist wrongly said "fully booked".
const satMorning = new Date("2026-11-28T07:51:30Z");

// 1. Saturday after the lead-time cutoff is past_cutoff, not fully_booked.
const sat = dayStatus(config, "2026-11-28", [], satMorning);
assert.strictEqual(sat.reason, "past_cutoff");
assert.deepStrictEqual(sat.open, []);

// 2. Sunday is closed; a date past maxDaysAhead is beyond the horizon.
assert.strictEqual(dayStatus(config, "2026-11-29", [], satMorning).reason, "closed");
assert.strictEqual(dayStatus(config, "2027-03-02", [], satMorning).reason, "beyond_horizon");

// 3. A weekday whose calendar is blocked all day is genuinely fully_booked.
const allDay = [{ start: "2026-11-29T22:00:00Z", end: "2026-11-30T22:00:00Z" }];
assert.strictEqual(dayStatus(config, "2026-11-30", allDay, satMorning).reason, "fully_booked");

// 4. A normal weekday is open.
assert.strictEqual(dayStatus(config, "2026-11-30", [], satMorning).reason, "open");

// 5. Duration: a 45 min service must not overlap an 11:00 to 11:45 booking.
const busy = [{ start: "2026-11-30T09:00:00Z", end: "2026-11-30T09:45:00Z" }]; // 11:00 SAST
const open45 = computeOpenSlots(config, "2026-11-30", busy, satMorning, 45);
assert.ok(!open45.includes("10:30"), "10:30 + 45 min runs into the 11:00 booking");
assert.ok(open45.includes("10:00"), "10:00 + 45 min ends 10:45, clear");
assert.ok(open45.includes("11:30") === false, "11:30 still inside the 11:00 to 11:45 booking");
assert.ok(open45.includes("12:00"));

// 6. Duration: the service must also finish before closing (Sat closes 12:00).
const sat45 = computeOpenSlots(config, "2026-12-05", [], satMorning, 45);
assert.ok(sat45.includes("11:00") && !sat45.includes("11:30"), "11:30 + 45 min passes 12:00 close");

// 7. Tool end to end: closed day returns a reason and real alternatives, no invented times.
async function main(): Promise<void> {
  const store = new MemoryStore();
  const pack = loadPack("practitioner");
  const customer = await store.getOrCreateCustomer("meridian", "+27820001111");
  const ctx: ToolCtx = { config, pack, backend: new MemoryBackend(), store, businessId: "meridian", customerId: customer.id };

  // Next Sunday, whatever today is.
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7 || 7));
  const sunday = d.toISOString().slice(0, 10);

  const res = JSON.parse(await executeTool("check_availability", { date: sunday, service: "Sports massage" }, ctx));
  assert.strictEqual(res.reason, "closed");
  assert.deepStrictEqual(res.open, []);
  assert.ok(Array.isArray(res.nextAvailable) && res.nextAvailable.length > 0, "offers real next days");
  for (const day of res.nextAvailable) assert.ok(day.open.length > 0 && day.date > sunday);
  assert.ok(!/fully booked/i.test(res.note), "a closed day is not described as booked");

  console.log("availability: all checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
