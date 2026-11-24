import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GoogleCalendarBackend } from "../src/booking/googleCalendar.js";
import { loadPack } from "../src/brain/pack.js";
import { executeTool } from "../src/brain/tools.js";
import { getConfig } from "../src/config/store.js";
import { SupabaseStore } from "../src/db/supabase.js";

// Run against a test calendar and database. Cancellation leaves a test record in Supabase.
async function main(): Promise<void> {
  assert.ok(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY, "Configure the Supabase test project first.");
  const store = new SupabaseStore();
  const businessId = "meridian";
  const config = await getConfig(businessId);
  const timeZone = config.practice.timezone;
  const backend = new GoogleCalendarBackend({ timeZone });
  const pack = loadPack(config.vertical);
  const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" });
  const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone, timeStyle: "short" });

  let eventId: string | undefined;
  const createEvent = backend.createEvent.bind(backend);
  backend.createEvent = async (input) => {
    const event = await createEvent(input);
    eventId = event.eventId;
    return event;
  };

  const customer = await store.getOrCreateCustomer(businessId, `synthetic-calendar-${randomUUID()}`);
  const context = { store, backend, businessId, customerId: customer.id, config, pack };
  const call = async (name: string, input: Record<string, unknown>) =>
    JSON.parse(await executeTool(name, input, context));
  let slot: { date: string; time: string } | undefined;
  for (let days = 2; days <= 8; days++) {
    const date = dayFormat.format(new Date(Date.now() + days * 86_400_000));
    const { open } = await call("check_availability", { date });
    if (open.length) {
      slot = { date, time: open.includes("09:00") ? "09:00" : open[0] };
      break;
    }
  }
  assert.ok(slot, "No open Meridian test slot in the next week.");

  let reference: string | undefined;
  try {
    const result = await call("book_appointment", {
      ...slot,
      name: "Synthetic Calendar Verification",
      service: config.services[0].name,
    });
    assert.equal(result.status, "confirmed", "Booking should confirm.");
    reference = result.reference;
    assert.ok(reference && eventId, "Booking and Google Calendar should both return an ID.");
    const saved = await new SupabaseStore().findEngagementByReference(businessId, reference);
    assert.equal(saved?.status, "confirmed");
    assert.equal(saved?.backendEventId, eventId);
    assert.ok(saved?.startsAt);
    const start = new Date(saved.startsAt);
    assert.equal(dayFormat.format(start), slot.date);
    assert.equal(timeFormat.format(start), slot.time);
    const busy = await backend.getBusy(slot.date, timeZone);
    assert.ok(busy.some((block) => Date.parse(block.start) <= start.getTime() && Date.parse(block.end) > start.getTime()));
    assert.ok(!(await call("check_availability", { date: slot.date })).open.includes(slot.time));
    console.log(`Verified ${reference} in Supabase and Google Calendar at ${slot.date} ${slot.time} (${timeZone}).`);

    const { open } = await call("check_availability", { date: slot.date });
    const nextTime = open.find((time: string) => time > slot!.time) ?? open[0];
    assert.ok(nextTime, "No alternate Meridian test slot on the booked day.");
    const moved = await call("reschedule_appointment", { date: slot.date, time: nextTime });
    assert.equal(moved.status, "confirmed");
    assert.equal(moved.reference, reference);
    const rescheduled = await store.findEngagementByReference(businessId, reference);
    assert.equal(rescheduled?.backendEventId, eventId);
    assert.equal(timeFormat.format(new Date(rescheduled!.startsAt!)), nextTime);
    const afterMove = (await call("check_availability", { date: slot.date })).open;
    assert.ok(afterMove.includes(slot.time), "The original slot did not reopen after postponement.");
    assert.ok(!afterMove.includes(nextTime), "The new slot is not blocked after postponement.");
    slot.time = nextTime;
    console.log("Postponed without a reference and kept the same Supabase reference and calendar event.");
  } finally {
    if (reference) {
      const cancellation = await call("cancel_appointment", {});
      assert.equal(cancellation.status, "cancelled");
      const saved = await new SupabaseStore().findEngagementByReference(businessId, reference);
      assert.equal(saved?.status, "cancelled");
      assert.ok((await call("check_availability", { date: slot.date })).open.includes(slot.time), "Calendar slot did not reopen.");
      console.log("Synthetic appointment cancelled and the slot reopened.");
    } else if (eventId) {
      await backend.cancelEvent(eventId);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Booking integration check failed.");
  process.exitCode = 1;
});
