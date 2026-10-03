import type { Deps } from "./handler";

// Scheduled job handlers, invoked by the n8n schedule workflows through the
// /cron/* routes on the server. n8n stays pure triggers-and-transport; the
// Core owns all logic: selecting due rows, rendering the pack template,
// sending, and stamping the row. See n8n/ARCHITECTURE.md.
//
// Wired stubs: the control flow and return shape are final; the row selection
// and template rendering land in the next build step, and need query methods on
// the Store (due reminders, completed engagements, lapsed customers) plus a
// template layer per vertical pack.

export interface CronResult {
  sent: number;
  skipped: number;
  failed: number;
}

// Reminders (hourly): confirmed engagements inside the reminder window with
// reminder_sent_at null. Send *_reminder, then stamp. The stamp is idempotency.
export async function runReminders(_deps: Deps): Promise<CronResult> {
  throw new Error("runReminders not yet implemented");
}

// Follow-up (daily): completed engagements past the delay with followup_sent_at null.
export async function runFollowup(_deps: Deps): Promise<CronResult> {
  throw new Error("runFollowup not yet implemented");
}

// Reactivation (weekly): customers lapsed beyond N days with nothing upcoming.
export async function runReactivation(_deps: Deps): Promise<CronResult> {
  throw new Error("runReactivation not yet implemented");
}

// Waitlist safety net (~15 min): release slots freed outside the app.
export async function runWaitlist(_deps: Deps): Promise<CronResult> {
  throw new Error("runWaitlist not yet implemented");
}
