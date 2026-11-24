import "dotenv/config";
import assert from "node:assert";
import { MemoryStore } from "../src/db/memory.js";
import { MemoryBackend } from "../src/booking/memory.js";
import { MemoryNotifier } from "../src/channel/notifier.js";
import { loadConfig } from "../src/config/load.js";
import { loadPack } from "../src/brain/pack.js";
import { executeTool, type ToolCtx } from "../src/brain/tools.js";
import { runFollowup, runReactivation, runWaitlist } from "../src/cron.js";

// Phase 5 gate: the booking lifecycle tools (reschedule, cancel, join_waitlist)
// and the follow-up, reactivation and waitlist jobs, driven directly against the
// in-memory adapters. No Claude API needed; executors are plain functions.
//   npm run test:lifecycle

const store = new MemoryStore();
const backend = new MemoryBackend();
const notifier = new MemoryNotifier();
const config = loadConfig("meridian");
const pack = loadPack(config.vertical);

async function call(name: string, input: Record<string, unknown>, ctx: ToolCtx) {
  return JSON.parse(await executeTool(name, input, ctx));
}

// Find a date within the horizon that has open slots, and its first open time.
async function firstOpen(ctx: ToolCtx, skipDates: string[] = []): Promise<{ date: string; time: string }> {
  for (let i = 2; i <= 20; i++) {
    const date = new Date(Date.now() + i * 864e5).toISOString().slice(0, 10);
    if (skipDates.includes(date)) continue;
    const res = await call("check_availability", { date }, ctx);
    if (Array.isArray(res.open) && res.open.length > 0) return { date, time: res.open[0] };
  }
  throw new Error("no open slot found in the horizon");
}

async function main(): Promise<void> {
  const customer = await store.getOrCreateCustomer("meridian", "+27820001111");
  const ctx: ToolCtx = {
    config,
    pack,
    backend,
    store,
    businessId: "meridian",
    customerId: customer.id,
  };

  // book -> reschedule -> cancel
  const slot1 = await firstOpen(ctx);
  const booked = await call(
    "book_appointment",
    { name: "Thandi", service: "Follow-up session", date: slot1.date, time: slot1.time },
    ctx,
  );
  assert.strictEqual(booked.status, "confirmed", "booking should confirm");
  assert.ok(booked.reference, "booking returns a reference");
  const saved = await store.findEngagementByReference(ctx.businessId, booked.reference);
  const startsAt = saved?.startsAt;
  assert.ok(startsAt, "booking has a saved start time");
  assert.ok(startsAt.endsWith("Z"), "booking is stored as a UTC instant");
  const savedTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.practice.timezone,
    timeStyle: "short",
  }).format(new Date(startsAt));
  assert.strictEqual(savedTime, slot1.time, "stored instant preserves the local booking time");

  const slot2 = await firstOpen(ctx, [slot1.date]);
  const stranger = await store.getOrCreateCustomer("meridian", "+27820009999");
  const strangerCtx = { ...ctx, customerId: stranger.id };
  assert.deepStrictEqual((await call("list_upcoming_bookings", {}, strangerCtx)).bookings, []);
  assert.strictEqual(
    (await call("cancel_appointment", { reference: booked.reference }, strangerCtx)).status, "not_found",
    "a booking reference does not grant access to another customer's appointment",
  );

  const moved = await call(
    "reschedule_appointment",
    { date: slot2.date, time: slot2.time },
    ctx,
  );
  assert.strictEqual(moved.status, "confirmed", "reschedule should confirm");
  assert.strictEqual(moved.date, slot2.date, "reschedule moved the date");
  assert.strictEqual(moved.reference, booked.reference, "rescheduling keeps the reference");
  assert.strictEqual(
    (await store.findEngagementByReference(ctx.businessId, booked.reference))?.backendEventId,
    saved?.backendEventId,
    "rescheduling keeps the calendar event",
  );
  assert.ok((await call("check_availability", { date: slot1.date }, ctx)).open.includes(slot1.time));

  const secondBooking = await call(
    "book_appointment",
    { name: "Thandi", service: "Follow-up session", ...slot1 },
    ctx,
  );
  assert.strictEqual((await call("cancel_appointment", {}, ctx)).status, "needs_selection");
  assert.strictEqual(
    (await call("cancel_appointment", { reference: secondBooking.reference }, ctx)).status, "cancelled",
  );

  const cancelled = await call("cancel_appointment", {}, ctx);
  assert.strictEqual(cancelled.status, "cancelled", "cancel should cancel");
  assert.strictEqual(cancelled.reference, booked.reference);
  assert.ok((await call("check_availability", { date: slot2.date }, ctx)).open.includes(slot2.time));
  const recancel = await call("cancel_appointment", { reference: booked.reference }, ctx);
  assert.strictEqual(recancel.status, "not_found", "re-cancel is not_found");

  // join_waitlist -> runWaitlist notifies because the date has open slots
  const waitDate = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  const wl = await call("join_waitlist", { name: "Sipho", service: "Sports massage", date: waitDate }, ctx);
  assert.strictEqual(wl.status, "waitlisted", "join_waitlist waitlists");

  const before = notifier.sent.length;
  const w1 = await runWaitlist({ store, backend, notifier });
  assert.strictEqual(w1.sent, 1, `waitlist should notify 1, got ${w1.sent}`);
  assert.ok(notifier.sent[before].text.includes("space has opened"), "waitlist message sent");
  const w2 = await runWaitlist({ store, backend, notifier });
  assert.strictEqual(w2.sent, 0, "waitlist is idempotent after notifying");

  // follow-up: a past confirmed engagement gets one follow-up, then none
  const past = new Date(Date.now() - 2 * 864e5).toISOString();
  const fCustomer = await store.getOrCreateCustomer("meridian", "+27820002222");
  await store.createEngagement({
    businessId: "meridian",
    customerId: fCustomer.id,
    kind: "appointment",
    service: "Initial consultation",
    startsAt: past,
    durationMin: 45,
    status: "confirmed",
    reference: "C7-PAST1",
  });
  const f1 = await runFollowup({ store, backend, notifier });
  assert.strictEqual(f1.sent, 1, `followup should send 1, got ${f1.sent}`);
  const f2 = await runFollowup({ store, backend, notifier });
  assert.strictEqual(f2.sent, 0, "followup is idempotent");
  await store.createEngagement({
    businessId: "meridian",
    customerId: fCustomer.id,
    kind: "appointment",
    startsAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    durationMin: 45,
    status: "confirmed",
  });
  const during = await runFollowup({ store, backend, notifier });
  assert.strictEqual(during.sent, 0, "followup waits until the appointment is over");
  const after = await runFollowup({ store, backend, notifier }, new Date(Date.now() + 45 * 60_000));
  assert.strictEqual(after.sent, 1, "followup is due after the appointment ends");

  // reactivation: a customer whose only visit is >30 days ago, nothing upcoming
  const old = new Date(Date.now() - 60 * 864e5).toISOString();
  const rCustomer = await store.getOrCreateCustomer("meridian", "+27820003333");
  await store.createEngagement({
    businessId: "meridian",
    customerId: rCustomer.id,
    kind: "appointment",
    service: "Follow-up session",
    startsAt: old,
    durationMin: 30,
    status: "completed",
    reference: "C7-OLD1",
  });
  const r1 = await runReactivation({ store, backend, notifier });
  assert.ok(r1.sent >= 1, `reactivation should send at least 1, got ${r1.sent}`);
  const r2 = await runReactivation({ store, backend, notifier });
  assert.strictEqual(r2.sent, 0, "reactivation is idempotent inside the window");

  console.log("lifecycle test passed:");
  console.log(`  book/reschedule/cancel: ok`);
  console.log(`  waitlist:  ${JSON.stringify(w1)} then ${JSON.stringify(w2)}`);
  console.log(`  followup:  ${JSON.stringify(f1)} then ${JSON.stringify(f2)}`);
  console.log(`  reactivation: ${JSON.stringify(r1)} then ${JSON.stringify(r2)}`);
}

main().catch((e) => {
  console.error("lifecycle test FAILED:", (e as Error).message);
  process.exit(1);
});
