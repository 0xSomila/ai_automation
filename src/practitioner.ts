import type { Config } from "./config/types.js";
import { getConfig, listConfigs } from "./config/store.js";
import type { Deps } from "./handler.js";
import type { Notification } from "./channel/notifier.js";
import type { PractitionerNotice } from "./db/types.js";
import type { CronResult } from "./cron.js";
import { practiceDay } from "./booking/time.js";

function text(value: unknown, fallback = ""): string {
  return String(value ?? fallback).replace(/\s+/g, " ").trim();
}

function localTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
}

function localAppointment(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(instant));
}

export function practitionerMessage(notice: PractitionerNotice, config: Config): Notification {
  const payload = notice.payload;
  if (notice.kind === "daily") {
    const params = [text(payload.date), text(payload.part), text(payload.summary)];
    return { to: notice.recipient, templateName: "practitioner_daily_schedule", params,
      text: `Your appointment schedule for ${params[0]} (part ${params[1]}): ${params[2]}. This summary reflects the schedule when it was sent. Updates will arrive separately.` };
  }

  const startsAt = text(payload.startsAt);
  const previous = text(payload.previousStartsAt);
  const timezone = config.practice.timezone;
  const earliest = Math.min(Date.parse(startsAt), previous ? Date.parse(previous) : Infinity);
  const hoursUntil = (earliest - Date.parse(notice.createdAt)) / 36e5;
  const lastMinuteHours = config.practitionerNotifications?.lastMinuteHours ?? 24;
  const priority = hoursUntil >= 0 && hoursUntil <= lastMinuteHours
    ? `Last-minute, within ${lastMinuteHours} hours` : "Schedule update";
  const schedule = previous && payload.action === "Rescheduled"
    ? `${localAppointment(previous, timezone)} to ${localAppointment(startsAt, timezone)}`
    : localAppointment(startsAt, timezone);
  const bookedFor = payload.bookingName ? ` for ${text(payload.bookingName).slice(0, 80)}` : "";
  const detail = `${text(payload.service, "Appointment")}${bookedFor} at ${schedule}`;
  const params = [text(payload.action), text(payload.reference, "Unreferenced appointment"), detail, priority];
  return { to: notice.recipient, templateName: "practitioner_appointment_update", params,
    text: `Appointment update: ${params[0]}. Reference: ${params[1]}. Schedule: ${params[2]}. Priority: ${params[3]}. Please check your calendar for the current schedule.` };
}

export async function enqueueDailySchedule(deps: Deps, config: Config, now = new Date()): Promise<void> {
  const settings = config.practitionerNotifications;
  if (!settings) return;
  const timezone = config.practice.timezone;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  if (localTime(now.toISOString(), timezone) < settings.dailyTime) return;
  const [start, end] = practiceDay(date, timezone);
  const appointments = await deps.store.dailyAppointments(config.slug, new Date(start).toISOString(), new Date(end).toISOString());
  const lines = appointments.map((booking) => `${localTime(booking.startsAt!, timezone)} ${text(booking.bookingName, "Booked patient").slice(0, 60)}, ${text(booking.service, "Appointment").slice(0, 80)} (${booking.durationMin ?? config.booking.slotStepMin} min), ${text(booking.reference, "unreferenced")}`);
  const summaries: string[] = [];
  let summary = "";
  for (const line of lines) {
    if (summary.length + line.length + 3 > 800) {
      summaries.push(summary);
      summary = "";
    }
    summary += (summary ? " | " : "") + line;
  }
  summaries.push(summary || "No confirmed appointments today");
  const parts = summaries.map((content, index) => ({ date, part: `${index + 1}/${summaries.length}`, summary: content }));
  await deps.store.enqueuePractitionerDaily(config.slug, settings.whatsappPhone, date, new Date(end).toISOString(), parts);
}

export async function dispatchPractitionerNotices(deps: Deps, config: Config, limit = 25): Promise<CronResult> {
  const result: CronResult = { sent: 0, skipped: 0, failed: 0 };
  const settings = config.practitionerNotifications;
  if (!settings) return result;
  for (let index = 0; index < limit; index++) {
    const notice = await deps.store.claimPractitionerNotice(config.slug);
    if (!notice) break;
    if (notice.recipient !== settings.whatsappPhone) {
      // A recipient change needs an explicit review of already queued notices.
      await deps.store.finishPractitionerNotice(notice.id, notice.leaseToken, false);
      result.skipped++;
      continue;
    }
    try {
      await deps.notifier.send(practitionerMessage(notice, config));
    } catch (error) {
      const providerCode = error instanceof Error ? error.message.match(/"code"\s*:\s*(\d+)/)?.[1] : undefined;
      console.warn(`Practitioner notice ${notice.id} send failed${providerCode ? ` (Meta ${providerCode})` : ""}`);
      await deps.store.finishPractitionerNotice(notice.id, notice.leaseToken, false);
      result.failed++;
      continue;
    }
    // Keep an accepted send claimed if the stamp fails, and let the worker report it.
    await deps.store.finishPractitionerNotice(notice.id, notice.leaseToken, true);
    result.sent++;
  }
  return result;
}

export async function runPractitionerUpdates(deps: Deps, now = new Date()): Promise<CronResult> {
  const total: CronResult = { sent: 0, skipped: 0, failed: 0 };
  for (const { slug } of await listConfigs()) {
    try {
      const config = await getConfig(slug);
      if (!config.practitionerNotifications) continue;
      await enqueueDailySchedule(deps, config, now);
      const result = await dispatchPractitionerNotices(deps, config);
      total.sent += result.sent;
      total.skipped += result.skipped;
      total.failed += result.failed;
    } catch {
      console.error(`Practitioner updates failed for business ${slug}`);
      total.failed++;
    }
  }
  return total;
}
