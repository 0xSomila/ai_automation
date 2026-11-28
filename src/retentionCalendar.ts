import "dotenv/config";
import { GoogleCalendarBackend } from "./booking/googleCalendar.js";
import { createSupabaseServerClient } from "./db/client.js";

async function main(): Promise<void> {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_CALENDAR_ID, MERIDIAN_RETENTION_CALENDAR_ID } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase is required for calendar retention.");
  if (!MERIDIAN_RETENTION_CALENDAR_ID || MERIDIAN_RETENTION_CALENDAR_ID !== GOOGLE_CALENDAR_ID) {
    throw new Error("Set MERIDIAN_RETENTION_CALENDAR_ID to the dedicated Meridian calendar ID.");
  }

  const db = createSupabaseServerClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const backend = new GoogleCalendarBackend({ calendarId: MERIDIAN_RETENTION_CALENDAR_ID });
  const { data, error } = await db.rpc("meridian_calendar_cleanup_batch");
  if (error) throw new Error(error.message);

  const pending = (data ?? []) as { event_id: string }[];
  // A missing event is safe to acknowledge only after confirming calendar access.
  if (pending.length) await backend.getBusy(new Date().toISOString().slice(0, 10));
  let failures = 0;
  for (const { event_id } of pending) {
    try {
      await backend.eraseEvent(event_id);
      const { error } = await db.rpc("finish_meridian_calendar_cleanup", { completed_event_id: event_id });
      if (error) throw error;
    } catch {
      failures++;
    }
  }
  console.log(`Meridian calendar retention processed ${pending.length - failures} event(s). ${failures} queued for retry.`);
  if (failures) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Meridian calendar retention failed.");
  process.exitCode = 1;
});
