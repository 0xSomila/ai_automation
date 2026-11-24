import assert from "node:assert/strict";
import { MemoryStore } from "../src/db/memory";
import { MemoryBackend } from "../src/booking/memory";
import { MemoryNotifier } from "../src/channel/notifier";
import { loadConfig } from "../src/config/load";
import { enqueueDailySchedule, dispatchPractitionerNotices, practitionerMessage } from "../src/practitioner";
import { executeTool, type ToolCtx } from "../src/brain/tools";
import { loadPack } from "../src/brain/pack";
import { practiceDay, practiceTime } from "../src/booking/time";

async function main(): Promise<void> {
  const phone = "+27820000001";
  const config = { ...loadConfig("meridian"), practitionerNotifications: { whatsappPhone: phone, dailyTime: "07:00", lastMinuteHours: 24 } };
  const store = new MemoryStore({ meridian: phone });
  const notifier = new MemoryNotifier();
  const backend = new MemoryBackend();
  const deps = { store, notifier, backend };
  const customer = await store.getOrCreateCustomer("meridian", "+27820000002");
  const ctx: ToolCtx = { store, backend, config, pack: loadPack("practitioner"), businessId: "meridian", customerId: customer.id };
  const call = async (tool: string, input: Record<string, unknown>) => JSON.parse(await executeTool(tool, input, ctx));
  let date = "";
  let open: string[] = [];
  for (let offset = 2; offset < 10; offset++) {
    date = new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
    open = (await call("check_availability", { date })).open;
    if (open.length > 2) break;
  }
  const booked = await call("book_appointment", { name: "Avery Testwell", service: "Initial consultation", date, time: open[0] });
  assert.equal(booked.status, "confirmed");
  const claim = await store.claimPractitionerNotice("meridian");
  assert.ok(claim);
  assert.equal(await store.claimPractitionerNotice("meridian"), null, "another worker cannot claim an in-flight alert");
  assert.equal(await store.claimPractitionerNotice("other-business"), null);
  await assert.rejects(store.finishPractitionerNotice(claim.id, "wrong-claim", true));
  await store.finishPractitionerNotice(claim.id, claim.leaseToken, true);
  assert.equal((await dispatchPractitionerNotices(deps, config)).sent, 0);
  const moved = await call("reschedule_appointment", { reference: booked.reference, date, time: open[2] });
  assert.equal(moved.status, "confirmed");
  assert.equal((await dispatchPractitionerNotices(deps, config)).sent, 1);
  assert.match(notifier.sent[0].text, /Rescheduled/);
  assert.ok(notifier.sent[0].text.includes(booked.reference));
  const cancelled = await call("cancel_appointment", {});
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await dispatchPractitionerNotices(deps, config)).sent, 1);
  assert.match(notifier.sent[1].text, /Cancelled/);
  await call("cancel_appointment", { reference: booked.reference });
  assert.equal((await dispatchPractitionerNotices(deps, config)).sent, 0, "retries of cancelled booking add no alert");

  const morning = new Date(practiceTime(date, "07:00", config.practice.timezone));
  await store.createEngagement({ businessId: "meridian", customerId: customer.id, kind: "appointment", status: "confirmed",
    service: "Initial consultation", startsAt: new Date(practiceTime(date, "10:00", config.practice.timezone)).toISOString(), durationMin: 45, reference: "C7-DAY1" });
  await enqueueDailySchedule(deps, config, new Date(morning.getTime() - 60_000));
  await dispatchPractitionerNotices(deps, config);
  const before = notifier.sent.length;
  await Promise.all([enqueueDailySchedule(deps, config, morning), enqueueDailySchedule(deps, config, morning)]);
  assert.equal((await dispatchPractitionerNotices(deps, config)).sent, 1);
  assert.equal(notifier.sent.length, before + 1);
  assert.match(notifier.sent.at(-1)!.text, /10:00.*C7-DAY1/);
  await enqueueDailySchedule(deps, config, morning);
  assert.equal((await dispatchPractitionerNotices(deps, config)).sent, 0);

  const urgent = practitionerMessage({ ...claim, createdAt: morning.toISOString(), payload: { action: "Rescheduled", reference: "C7-DAY1",
    service: "Initial consultation", previousStartsAt: new Date(morning.getTime() + 3600_000).toISOString(), startsAt: new Date(morning.getTime() + 7200_000).toISOString() } }, config);
  assert.match(urgent.text, /Last-minute/);
  assert.match(urgent.text, /08:00 to .*09:00/);
  const [start, end] = practiceDay(date, config.practice.timezone);
  assert.equal(end - start, 864e5);

  const failStore = new MemoryStore({ meridian: phone });
  await failStore.createEngagement({ businessId: "meridian", customerId: customer.id, kind: "appointment", status: "confirmed", startsAt: new Date(Date.now() + 3600_000).toISOString() });
  const failed = await dispatchPractitionerNotices({ ...deps, store: failStore, notifier: { send: async () => { throw new Error("Provider unavailable"); } } }, config);
  assert.equal(failed.failed, 1);
  assert.equal(await failStore.claimPractitionerNotice("meridian"), null, "failed sends back off before retry");

  const empty = new MemoryStore();
  const emptyNotifier = new MemoryNotifier();
  const emptyDeps = { ...deps, store: empty, notifier: emptyNotifier };
  await enqueueDailySchedule(emptyDeps, config, morning);
  assert.equal((await dispatchPractitionerNotices(emptyDeps, config)).sent, 1);
  assert.match(emptyNotifier.sent[0].text, /No confirmed appointments today/);
  const tomorrow = new Date(morning.getTime() + 864e5);
  await enqueueDailySchedule(emptyDeps, config, tomorrow);
  assert.equal((await dispatchPractitionerNotices(emptyDeps, config)).sent, 1, "the next local date gets a new digest");
  console.log("Practitioner tests passed: lifecycle alerts, preserved references, claims, tenant isolation, daily timing and deduplication, urgency, and retry backoff.");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
