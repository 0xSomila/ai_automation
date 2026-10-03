import "dotenv/config";
import assert from "node:assert";
import { MemoryStore } from "../src/db/memory";
import { MemoryBackend } from "../src/booking/memory";
import { MemoryNotifier } from "../src/channel/notifier";
import { runReminders } from "../src/cron";

// Phase 2 gate: a seeded due booking produces exactly one reminder and gets
// stamped; a second run sends nothing. Needs no API or external services.
//   npm run test:reminders

async function main(): Promise<void> {
  const store = new MemoryStore();
  const notifier = new MemoryNotifier();
  const deps = { store, backend: new MemoryBackend(), notifier };

  const soon = new Date(Date.now() + 3 * 36e5).toISOString(); // 3h away, inside 24h window
  const farOff = new Date(Date.now() + 6 * 864e5).toISOString(); // 6 days away, outside window

  const dueCustomer = await store.getOrCreateCustomer("meridian", "+27820000001");
  await store.createEngagement({
    businessId: "meridian",
    customerId: dueCustomer.id,
    kind: "appointment",
    service: "Follow-up session",
    startsAt: soon,
    durationMin: 30,
    status: "confirmed",
    reference: "C7-DUE1",
  });

  const laterCustomer = await store.getOrCreateCustomer("meridian", "+27820000002");
  await store.createEngagement({
    businessId: "meridian",
    customerId: laterCustomer.id,
    kind: "appointment",
    service: "Initial consultation",
    startsAt: farOff,
    durationMin: 45,
    status: "confirmed",
    reference: "C7-FAR1",
  });

  // First run: exactly one reminder (the due one), stamped.
  const first = await runReminders(deps);
  assert.strictEqual(first.sent, 1, `expected 1 sent, got ${first.sent}`);
  assert.strictEqual(notifier.sent.length, 1, "notifier should have 1 message");
  assert.ok(
    notifier.sent[0].text.includes("Meridian Physiotherapy"),
    "reminder text should name the business",
  );
  assert.strictEqual(notifier.sent[0].to, "+27820000001", "reminder went to the due customer");

  // Second run: idempotent, nothing new sent.
  const second = await runReminders(deps);
  assert.strictEqual(second.sent, 0, `second run should send 0, got ${second.sent}`);
  assert.strictEqual(notifier.sent.length, 1, "no duplicate reminder");

  console.log("reminders test passed:");
  console.log(`  first run:  ${JSON.stringify(first)}`);
  console.log(`  second run: ${JSON.stringify(second)}`);
  console.log(`  sent text:  ${notifier.sent[0].text}`);
}

main().catch((e) => {
  console.error("reminders test FAILED:", (e as Error).message);
  process.exit(1);
});
