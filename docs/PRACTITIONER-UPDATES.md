# Practitioner WhatsApp updates

The pilot sends a daily schedule to the configured practitioner phone at 07:00 in the practice's time zone. It queues an alert whenever an appointment is booked, rescheduled, or cancelled in the Core. For a move, the alert includes both the old time and new time and preserves the booking reference. Events inside 24 hours of either affected start are flagged as last-minute. The pilot recipient is the user's approved test handset.

## Setup

Apply `src/db/practitioner-notifications.sql` after `schema.sql`. This adds a protected outbox and an appointment trigger. Update the Meridian row in `businesses.config` with `practitionerNotifications.whatsappPhone` in international format, `dailyTime` as `HH:MM`, and `lastMinuteHours` as a non-negative number. Configure real recipient numbers directly in the private database or an ignored local config.

Submit the two English utility templates and wait for Meta approval. The payloads use these exact positional parameters.

| Template | Parameter order | Body |
| --- | --- | --- |
| `practitioner_appointment_update` | action, reference, schedule details, priority | Appointment update: {{1}}. Reference: {{2}}. Schedule: {{3}}. Priority: {{4}}. Please check your calendar for the current schedule. |
| `practitioner_daily_schedule` | local date, part number, appointment list | Your appointment schedule for {{1}} (part {{2}}): {{3}}. This summary reflects the schedule when it was sent. Updates will arrive separately. |

Appointment lists include the time, booking name when captured, service, duration, and reference. Records made before names were stored show `Booked patient`. Long schedules are split into messages with part numbers. An empty schedule explicitly says there are no confirmed appointments. These schedules read Automation OS booking records. Events created or moved directly in Google Calendar need a separate sync before those changes can generate these notifications.

## Scheduling

`npm run practitioner:run` queues the current day's summary once the configured send time has passed and dispatches pending notices. The digest is a snapshot at the first run, and later appointment changes get their own alerts. Digests expire at the next local midnight. For the Windows pilot, a scheduled task can run this command every minute while the computer is available. A missed morning run catches up on the same day. Hosted deployments use `n8n/practitioner.workflow.ts` to call `POST /cron/practitioner` every minute with `X-C7-Secret` and the active Core URL.

The webhook dispatches up to three queued notices after attempting the patient's reply. Scheduled runs retry failed sends. The recipient must be on Meta's approved test list when using the test sender. Use fictional appointments for the pilot.

## Reliability and retention

The database trigger queues an event in the same transaction as its appointment write. An exclusive claim prevents two workers processing the same business queue simultaneously. Failed sends back off, up to 15 minutes. A send is stamped after Meta accepts it. A crash after acceptance and before the stamp can still cause a duplicate on retry. `sent_at` means provider acceptance, and handset delivery needs separate verification. The queue expires collection data after 30 days through the worker, which should run continuously for cleanup. The daily key prevents duplicate summaries on repeated polls and concurrent runs.

Disable a business's `practitionerNotifications` field to stop scheduling and dispatch for that business. Review pending notices explicitly when changing recipients. The current sender and Calendar configuration still represents one practice per Core instance.

Run `npm run test:practitioner` for booking and change alerts, queue claims, tenant isolation, daily timing, empty schedules, sequential and concurrent-run suppression, last-minute flags, and retry backoff. Check the `practitioner` records in `cron_runs` for run counts and `practitioner_notifications` for pending or accepted messages. The existing `/ops/summary` endpoint exposes recent job counts behind its shared secret.

The Windows task `C7 Meridian Practitioner Updates` is installed for the local pilot. It is configured to run every minute when the computer and network are available. Use Task Scheduler to disable it when the pilot ends. It relies on the ignored local `.env`. The two practitioner templates were submitted on 21 November 2026 and verified as approved on 24 November. Database and calendar integration was verified with a fictional booking and a capturing test notifier. Daily schedule messages were accepted by Meta on 22 and 23 November. Live appointment-change delivery and actual recipient receipt still need verification. At the 24 November check, the latest database job record was on 23 November and Windows reported task result `2147946720`, requiring diagnosis before relying on the schedule.
