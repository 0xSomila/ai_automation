import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "../src/db/client";
import { SupabaseStore } from "../src/db/supabase";
import { GoogleCalendarBackend } from "../src/booking/googleCalendar";
import { getConfig } from "../src/config/store";
import { loadPack } from "../src/brain/pack";
import { executeTool } from "../src/brain/tools";
import { dispatchPractitionerNotices } from "../src/practitioner";

async function main(): Promise<void> {
  assert.ok(process.env.GOOGLE_CALENDAR_ID && process.env.GOOGLE_CALENDAR_ID === process.env.MERIDIAN_RETENTION_CALENDAR_ID);
  const db = createSupabaseServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const store = new SupabaseStore();
  const backend = new GoogleCalendarBackend();
  const config = await getConfig("meridian");
  assert.ok(config.practitionerNotifications, "Configure the pilot practitioner recipient first");
  const { count, error } = await db.from("practitioner_notifications").select("id", { head: true, count: "exact" })
    .eq("business_id", "meridian").is("sent_at", null);
  assert.ifError(error);
  assert.equal(count, 0, "Run with an empty practitioner queue and the worker stopped");
  const customer = await store.getOrCreateCustomer("meridian", `synthetic-practitioner-${randomUUID()}`);
  const context = { store, backend, config, businessId: "meridian", customerId: customer.id, pack: loadPack("practitioner") };
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse(await executeTool(name, args, context));
  let slot: { date: string; time: string; nextTime: string } | undefined;
  for (let day = 2; day < 9; day++) {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: config.practice.timezone }).format(new Date(Date.now() + day * 864e5));
    const { open } = await call("check_availability", { date });
    if (open.length >= 5) { slot = { date, time: open[0], nextTime: open[4] }; break; }
  }
  assert.ok(slot);
  let reference: string | undefined;
  const delivered: string[] = [];
  const deps = { store, backend, notifier: { send: async ({ text }: { text: string }) => {
    assert.ok(reference && text.includes(reference), "Only the isolated fictional test's notices may be consumed");
    delivered.push(text);
  } } };
  try {
    const booked = await call("book_appointment", { name: "Avery Practitioner Test", service: "Initial consultation", date: slot.date, time: slot.time });
    assert.equal(booked.status, "confirmed");
    reference = booked.reference;
    const moved = await call("reschedule_appointment", { date: slot.date, time: slot.nextTime });
    assert.equal(moved.status, "confirmed");
    assert.equal(moved.reference, reference);
  } finally {
    if (reference) assert.equal((await call("cancel_appointment", { reference })).status, "cancelled");
  }
  const queued = await db.from("practitioner_notifications").select("payload").eq("business_id", "meridian").eq("payload->>reference", reference!);
  assert.ifError(queued.error);
  assert.equal(queued.data?.length, 3, "Database triggers must capture all three normal lifecycle mutations");
  assert.ok(queued.data.every((row) => row.payload.bookingName === "Avery Practitioner Test"));
  const result = await dispatchPractitionerNotices(deps, config);
  assert.equal(result.sent, 3);
  assert.equal(result.failed, 0);
  assert.match(delivered[0], /New booking/);
  assert.match(delivered[1], /Rescheduled/);
  assert.match(delivered[2], /Cancelled/);
  assert.equal((await dispatchPractitionerNotices(deps, config)).sent, 0);
  const { open } = await call("check_availability", { date: slot.date });
  assert.ok(open.includes(slot.time) && open.includes(slot.nextTime));
  console.log("Real pilot integration passed: booking, move, cancellation, atomic alert queue, preserved reference and name, accepted-test stamps, and reopened Calendar slots. Messages captured by the test notifier.");
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Practitioner integration failed"); process.exitCode = 1; });
