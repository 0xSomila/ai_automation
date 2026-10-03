import "dotenv/config";
import assert from "node:assert";
import { MemoryStore } from "../src/db/memory";
import { MemoryBackend } from "../src/booking/memory";
import { loadConfig } from "../src/config/load";
import { loadPack } from "../src/brain/pack";
import { executeTool, type ToolCtx } from "../src/brain/tools";

// Phase 6 gate: the restaurant covers resource model. Availability is capacity
// minus reserved covers at a slot; the party-size limit routes large groups to an
// enquiry; a slot with no room for the party is not offered. No Claude API needed.
//   npm run test:covers

const store = new MemoryStore();
const config = loadConfig("harbour");
const pack = loadPack("restaurant");
assert.strictEqual(pack.resourceModel.kind, "covers", "restaurant pack is covers");

async function call(name: string, input: Record<string, unknown>, ctx: ToolCtx) {
  return JSON.parse(await executeTool(name, input, ctx));
}

async function firstOpen(ctx: ToolCtx, party: number): Promise<{ date: string; time: string }> {
  for (let i = 2; i <= 20; i++) {
    const date = new Date(Date.now() + i * 864e5).toISOString().slice(0, 10);
    const res = await call("check_availability", { date, party }, ctx);
    if (Array.isArray(res.open) && res.open.length > 0) return { date, time: res.open[0] };
  }
  throw new Error("no open covers slot found");
}

async function main(): Promise<void> {
  const customer = await store.getOrCreateCustomer("harbour", "+27820009999");
  const ctx: ToolCtx = { config, pack, backend: new MemoryBackend(), store, businessId: "harbour", customerId: customer.id };

  // A party of 6 can reserve.
  const slot = await firstOpen(ctx, 6);
  const booked = await call(
    "book_appointment",
    { name: "Sipho", date: slot.date, time: slot.time, party: 6 },
    ctx,
  );
  assert.strictEqual(booked.status, "confirmed", "party of 6 reserves");
  assert.strictEqual(booked.party, 6, "party recorded");

  // Fill the slot to 38 of 40 covers (6 + 8 + 8 + 8 + 8), each within the party limit,
  // then the slot has only 2 left.
  for (const name of ["A", "B", "C2", "D2"]) {
    const r = await call("book_appointment", { name, date: slot.date, time: slot.time, party: 8 }, ctx);
    assert.strictEqual(r.status, "confirmed", `filling booking for ${name} should confirm`);
  }

  const availBig = await call("check_availability", { date: slot.date, party: 6 }, ctx);
  assert.ok(
    !availBig.open.includes(slot.time),
    "slot with 2 seats left is not offered to a party of 6",
  );
  const availSmall = await call("check_availability", { date: slot.date, party: 2 }, ctx);
  assert.ok(availSmall.open.includes(slot.time), "slot with 2 seats left is still offered to a party of 2");

  // Booking the full slot for 6 is rejected as unavailable.
  const over = await call("book_appointment", { name: "C", date: slot.date, time: slot.time, party: 6 }, ctx);
  assert.strictEqual(over.status, "unavailable", "overbooking the slot is rejected");

  // A party over the limit becomes an enquiry.
  const big = await call("book_appointment", { name: "D", date: slot.date, time: slot.time, party: 12 }, ctx);
  assert.strictEqual(big.status, "party_too_large", "party over the limit is routed to enquiry");

  console.log("covers test passed:");
  console.log(`  reserved party 6 at ${slot.date} ${slot.time}`);
  console.log(`  after 38/40 covers: party 6 excluded, party 2 included`);
  console.log(`  overbook -> unavailable; party 12 -> party_too_large`);
}

main().catch((e) => {
  console.error("covers test FAILED:", (e as Error).message);
  process.exit(1);
});
