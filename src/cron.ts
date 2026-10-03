import type { Deps } from "./handler";
import { loadConfig } from "./config/load";
import { loadPack } from "./brain/pack";
import { loadTemplate, renderTemplate, reminderTemplateName } from "./templates";

// Scheduled job handlers, invoked by the n8n schedule workflows through the
// /cron/* routes on the server. n8n stays pure triggers-and-transport; the
// Core owns all logic: selecting due rows, rendering the pack template,
// sending, and stamping the row. See n8n/ARCHITECTURE.md.

export interface CronResult {
  sent: number;
  skipped: number;
  failed: number;
}

const DEFAULT_REMINDER_HOURS = 24;

function formatInZone(iso: string, tz: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-ZA", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-ZA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { date, time };
}

// Reminders (hourly): confirmed engagements inside the reminder window with
// reminder_sent_at null. Render the pack's *_reminder template, send, then stamp.
// The stamp is the idempotency guard, so a second run in the same window sends nothing.
export async function runReminders(deps: Deps): Promise<CronResult> {
  const result: CronResult = { sent: 0, skipped: 0, failed: 0 };
  const nowISO = new Date().toISOString();

  // Window = the max reminderHoursBefore across configs we might touch. We read
  // per-business config below; query generously at 48h then filter per business.
  const due = await deps.store.dueReminders(nowISO, 48);

  for (const d of due) {
    try {
      const config = loadConfig(d.businessId);
      const windowHours = config.booking.reminderHoursBefore ?? DEFAULT_REMINDER_HOURS;
      const leadMs = Date.parse(d.startsAt) - Date.parse(nowISO);
      if (leadMs > windowHours * 36e5) {
        result.skipped++; // not yet inside this business's reminder window
        continue;
      }

      const pack = loadPack(config.vertical);
      const templateName = reminderTemplateName(pack.templates);
      if (!templateName) {
        result.skipped++;
        continue;
      }

      const { date, time } = formatInZone(d.startsAt, config.practice.timezone);
      const vars = {
        name: d.customerName ?? "there",
        service: d.service ?? "appointment",
        business: config.practice.name,
        date,
        time,
      };
      const text = renderTemplate(loadTemplate(config.vertical, templateName), vars);

      await deps.notifier.send({
        to: d.customerPhone,
        text,
        templateName,
        params: [vars.name, vars.service, vars.date, vars.time],
      });
      await deps.store.markReminderSent(d.engagementId, nowISO);
      result.sent++;
    } catch (e) {
      console.error(`reminder failed for engagement ${d.engagementId}:`, (e as Error).message);
      result.failed++;
    }
  }

  return result;
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
