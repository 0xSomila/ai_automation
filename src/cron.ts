import type { Deps } from "./handler";
import { loadConfig } from "./config/load";
import { loadPack } from "./brain/pack";
import { computeOpenSlots } from "./booking/availability";
import {
  loadTemplate,
  renderTemplate,
  reminderTemplateName,
  followupTemplateName,
} from "./templates";

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

// Follow-up (daily): past confirmed/completed engagements with no follow-up sent.
// Render the pack's *_followup template, send, stamp followup_sent_at.
export async function runFollowup(deps: Deps): Promise<CronResult> {
  const result: CronResult = { sent: 0, skipped: 0, failed: 0 };
  const nowISO = new Date().toISOString();
  const due = await deps.store.dueFollowups(nowISO);

  for (const d of due) {
    try {
      const config = loadConfig(d.businessId);
      const pack = loadPack(config.vertical);
      const templateName = followupTemplateName(pack.templates);
      if (!templateName) {
        result.skipped++;
        continue;
      }
      const vars = {
        name: d.customerName ?? "there",
        service: d.service ?? "visit",
        business: config.practice.name,
      };
      const text = renderTemplate(loadTemplate(config.vertical, templateName), vars);
      await deps.notifier.send({
        to: d.customerPhone,
        text,
        templateName,
        params: [vars.name, vars.service],
      });
      await deps.store.markFollowupSent(d.engagementId, nowISO);
      result.sent++;
    } catch (e) {
      console.error(`followup failed for engagement ${d.engagementId}:`, (e as Error).message);
      result.failed++;
    }
  }
  return result;
}

const DEFAULT_DORMANT_DAYS = 30;

// Reactivation (weekly): customers lapsed beyond dormantDays with nothing upcoming.
// Render the pack's reactivation template, send, stamp the customer.
export async function runReactivation(deps: Deps): Promise<CronResult> {
  const result: CronResult = { sent: 0, skipped: 0, failed: 0 };
  const nowISO = new Date().toISOString();
  const due = await deps.store.dueReactivations(nowISO, DEFAULT_DORMANT_DAYS);

  for (const d of due) {
    try {
      const config = loadConfig(d.businessId);
      let body: string;
      try {
        body = loadTemplate(config.vertical, "reactivation");
      } catch {
        result.skipped++; // vertical has no reactivation template
        continue;
      }
      const vars = { name: d.customerName ?? "there", business: config.practice.name };
      const text = renderTemplate(body, vars);
      await deps.notifier.send({
        to: d.customerPhone,
        text,
        templateName: "reactivation",
        params: [vars.name],
      });
      await deps.store.markReactivated(d.customerId, nowISO);
      result.sent++;
    } catch (e) {
      console.error(`reactivation failed for customer ${d.customerId}:`, (e as Error).message);
      result.failed++;
    }
  }
  return result;
}

// Waitlist safety net (~15 min): for each un-notified waitlist entry, if a slot
// has opened on its date, message the customer and stamp waitlist_notified_at.
export async function runWaitlist(deps: Deps): Promise<CronResult> {
  const result: CronResult = { sent: 0, skipped: 0, failed: 0 };
  const nowISO = new Date().toISOString();
  const waiting = await deps.store.openWaitlist(nowISO);

  for (const w of waiting) {
    try {
      const config = loadConfig(w.businessId);
      const busy = await deps.backend.getBusy(w.date);
      const open = computeOpenSlots(config, w.date, busy);
      if (open.length === 0) {
        result.skipped++; // still full, keep waiting
        continue;
      }
      let body: string;
      try {
        body = loadTemplate(config.vertical, "waitlist_open");
      } catch {
        result.skipped++;
        continue;
      }
      const vars = {
        name: w.customerName ?? "there",
        business: config.practice.name,
        service: w.service ?? "appointment",
        date: w.date,
      };
      const text = renderTemplate(body, vars);
      await deps.notifier.send({
        to: w.customerPhone,
        text,
        templateName: "waitlist_open",
        params: [vars.name, vars.business, vars.date],
      });
      await deps.store.markWaitlistNotified(w.engagementId, nowISO);
      result.sent++;
    } catch (e) {
      console.error(`waitlist failed for engagement ${w.engagementId}:`, (e as Error).message);
      result.failed++;
    }
  }
  return result;
}
