/**
 * Scheduled job handlers, invoked by the n8n schedule workflows via the Core
 * HTTP surface. The Core owns all logic: selecting due rows, rendering the
 * vertical pack's template, sending, and stamping the row. See n8n/ARCHITECTURE.md.
 *
 * These are wired stubs. The control flow and return shape are final; the row
 * selection and template rendering land in build steps 2 and 3.
 */

export interface CronResult {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Reminders (hourly): engagements with status=confirmed, starts_at inside the
 * reminder window, reminder_sent_at is null. Send the pack's *_reminder template,
 * then stamp reminder_sent_at. The stamp is the idempotency guard.
 */
export async function runReminders(): Promise<CronResult> {
  // TODO(step 2): select due rows, render pack template, send, stamp.
  throw new Error("runReminders not yet implemented");
}

/** Follow-up (daily): completed engagements past the delay with followup_sent_at null. */
export async function runFollowup(): Promise<CronResult> {
  // TODO(step 3)
  throw new Error("runFollowup not yet implemented");
}

/** Reactivation (weekly): customers lapsed beyond N days with nothing upcoming. */
export async function runReactivation(): Promise<CronResult> {
  // TODO(step 3)
  throw new Error("runReactivation not yet implemented");
}

/** Waitlist safety net (~15 min): release slots freed outside the app. */
export async function runWaitlist(): Promise<CronResult> {
  // TODO(step 3)
  throw new Error("runWaitlist not yet implemented");
}
