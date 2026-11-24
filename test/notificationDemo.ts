import "dotenv/config";
import { setTimeout } from "node:timers/promises";
import { MemoryBackend } from "../src/booking/memory.js";
import { WhatsAppNotifier, type Notifier } from "../src/channel/notifier.js";
import { runFollowup, runReminders, type CronResult } from "../src/cron.js";
import { MemoryStore } from "../src/db/memory.js";

// An accelerated run of the real due-message jobs for one fictional appointment.
// Use --whatsapp only with the Meridian test sender and an approved test recipient.
async function main(): Promise<void> {
  const sendToWhatsApp = process.argv.includes("--whatsapp");
  let phone = "+27820000001";
  const notifier: Notifier = { send: async ({ text }) => { console.log(text); } };
  if (sendToWhatsApp) {
    const recipient = process.env.MERIDIAN_DEMO_RECIPIENT;
    if (process.env.WHATSAPP_PHONE_NUMBER_ID !== "1475998602260961" || !recipient || !/^\+[1-9]\d{7,14}$/.test(recipient)) {
      throw new Error("Configure the Meridian test sender and an approved MERIDIAN_DEMO_RECIPIENT in .env.");
    }
    phone = recipient;
  }

  const store = new MemoryStore();
  const businessId = "meridian";
  const customer = await store.getOrCreateCustomer(businessId, phone);
  customer.name = "Avery";
  const deps = { store, backend: new MemoryBackend(), notifier: sendToWhatsApp ? new WhatsAppNotifier() : notifier };
  const appointment = new Date(Date.now() + 24 * 60 * 60_000);
  appointment.setUTCSeconds(0, 0);
  const durationMin = 45;
  await store.createEngagement({
    businessId,
    customerId: customer.id,
    kind: "appointment",
    status: "confirmed",
    service: "Initial consultation",
    startsAt: appointment.toISOString(),
    durationMin,
    reference: "C7-DEMO",
  });

  function checkDelivery(label: string, result: CronResult): void {
    if (result.sent !== 1 || result.failed) throw new Error(`${label} did not send successfully.`);
    console.log(`${label} sent to ${sendToWhatsApp ? "the test WhatsApp number" : "the preview"}.`);
  }

  console.log("Accelerated Meridian demo for Avery, booking C7-DEMO.");
  await setTimeout(3000);
  const beforeVisit = new Date(appointment.getTime() - 23 * 60 * 60_000);
  checkDelivery("Reminder", await runReminders(deps, beforeVisit));
  await setTimeout(5000);
  const afterVisit = new Date(appointment.getTime() + (durationMin + 1) * 60_000);
  checkDelivery("Follow-up", await runFollowup(deps, afterVisit));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Notification demo failed.");
  process.exitCode = 1;
});
