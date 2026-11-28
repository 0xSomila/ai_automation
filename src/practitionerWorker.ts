import "dotenv/config";
import { SupabaseStore } from "./db/supabase.js";
import { GoogleCalendarBackend } from "./booking/googleCalendar.js";
import { WhatsAppNotifier } from "./channel/notifier.js";
import { runPractitionerUpdates } from "./practitioner.js";

// A local scheduled-task entry point for the pilot. Hosted n8n calls /cron/practitioner.
async function main(): Promise<void> {
  const deps = { store: new SupabaseStore(), backend: new GoogleCalendarBackend(), notifier: new WhatsAppNotifier() };
  const result = await runPractitionerUpdates(deps);
  await deps.store.recordCronRun("practitioner", result, new Date().toISOString());
  console.log(`Practitioner updates: ${result.sent} accepted, ${result.skipped} skipped, ${result.failed} failed.`);
  if (result.failed) process.exitCode = 1;
}

main().catch(() => {
  console.error("Practitioner worker failed. Check the pilot configuration and notification migration.");
  process.exitCode = 1;
});
