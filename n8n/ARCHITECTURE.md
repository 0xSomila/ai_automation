# n8n orchestration architecture

Reference for the delivery cell (Somila lead, Tshiamo build, Themba config and sign-off).
Read `../CLAUDE.md` and `../BUILD.md` first. This document says how n8n and the Core fit together.

## Inbound is direct; n8n runs the schedules

After the merge to the `src/` Core, the Core's own Express server (`src/server.ts`) is the
WhatsApp webhook. Meta posts straight to `/webhook`, which verifies the signature, dedupes,
and runs the brain. **n8n is not in the inbound path.** n8n's job is the scheduled jobs:
reminders, follow-up, reactivation, and the waitlist safety net, each calling a Core
`/cron/*` endpoint on a clock.

A standalone n8n inbound front (`inbound.workflow.ts`) is kept as an optional alternative for
teams that want n8n to own the external surface; if used, it forwards the raw body to the Core.
It is not required, and the deployed copy (n8n id `M8LcXtQ3X8YXzzi1`) can be left inactive.

## Governing principle: n8n is triggers and transport, the Core owns all logic

Vertical logic never enters n8n (CLAUDE.md). Message templates live in the vertical pack,
availability lives in the pack, the brain lives in the Core. So n8n does not render templates,
decide availability, or run the tool-loop. Every workflow is thin:

```
trigger  ->  call a Core HTTP endpoint  ->  log the result
```

All the thinking happens behind that endpoint, where the pack and client config are already loaded.
This keeps the same guarantees if n8n is ever swapped for another orchestrator.

## The Core HTTP surface (src/server.ts)

The Core's Express server is the webhook and the scheduled-job endpoint. The `/cron/*` calls
carry a shared secret header (`X-C7-Secret`, value `N8N_WEBHOOK_SECRET`); the Core rejects
cron calls without it. `/webhook` is public (Meta calls it) and is protected by the Meta HMAC
signature instead.

| Endpoint | Called by | Does |
| --- | --- | --- |
| `GET /healthz` | uptime checks | liveness |
| `GET /webhook` | Meta | verify handshake: echo `hub.challenge` when the verify token matches |
| `POST /webhook` | Meta | verify HMAC signature, ack 200 fast, dedupe on message id, run the brain, reply |
| `POST /cron/reminders` | `reminders` workflow | send due reminders, stamp `reminder_sent_at` |
| `POST /cron/followup` | `followup` workflow | send due follow-ups, stamp `followup_sent_at` |
| `POST /cron/reactivation` | `reactivation` workflow | message lapsed customers |
| `POST /cron/waitlist` | `waitlist` safety-net workflow | release freed slots to waitlisted customers |

```
Meta WhatsApp Cloud API
        |  webhook: GET verify, POST messages
        v
   Core /webhook  ->  verify signature, ack 200, dedupe, handler.ts
        |
        v
   Supabase + WhatsApp send + booking backend

   n8n schedules  --(X-C7-Secret)-->  Core /cron/*  (reminders, followup, reactivation, waitlist)
```

## Inbound path (direct to the Core)

Meta posts to `GET/POST /webhook` on the deployed `src/server.ts`:

1. GET: the verify handshake. The Core echoes `hub.challenge` when `hub.verify_token` matches
   `WHATSAPP_VERIFY_TOKEN`.
2. POST: the Core verifies the HMAC signature over the raw body (`WHATSAPP_APP_SECRET`),
   acks `200` immediately (Meta retries and disables slow webhooks), then dedupes on the
   provider message id (Meta re-delivers), looks up
   the business by `phoneNumberId`, loads pack + config, runs the brain, sends the reply, persists.

Error handling: the Core logs inbound failures. Because the ack is sent before processing and the
message id is deduped, Meta's retries do not double-reply.

## Workflows 2 to 4: reminders, followup, reactivation (the scheduled pattern)

Same shape, different endpoint and cadence:

1. Schedule Trigger (timezone `Africa/Johannesburg`).
2. HTTP Request to Core `POST /cron/<name>` with `X-C7-Secret`.
3. Core selects due rows, renders the pack template per business, sends, stamps the row.
4. Core returns `{ sent, skipped, failed }`; n8n logs it.

| Workflow | Cadence | Core selects | Then |
| --- | --- | --- | --- |
| reminders | hourly | `status=confirmed`, `starts_at` inside the reminder window, `reminder_sent_at is null` | send `*_reminder`, set `reminder_sent_at` |
| followup | daily | `status=completed`, past by the follow-up delay, `followup_sent_at is null` | send `*_followup`, set `followup_sent_at` |
| reactivation | weekly | customers whose last engagement is older than N days with nothing upcoming | send `reactivation` |

The `*_sent_at` stamps are the idempotency guard: a workflow that runs twice never double-sends.

## Workflow 5: waitlist (event-driven, with a safety net)

- Primary path: the Core `cancel` executor releases the freed slot in-process and notifies the next
  waitlisted customer immediately. No n8n latency.
- Safety net: an n8n Schedule Trigger (every ~15 min) hits `POST /cron/waitlist` to catch slots freed
  outside the app (a cancellation made directly in the calendar backend).

## Credentials (in n8n's credential store, never in the exported JSON)

- Core base URL and the shared secret (`N8N_WEBHOOK_SECRET`), for the `/cron/*` calls.
- No Supabase, Claude or WhatsApp keys in n8n. Those live in the Core env. That is the point.

## Idempotency and timezone

- Inbound: dedupe on the Meta message id (`processed_messages` table, via `claimMessage`).
- Scheduled: the `*_sent_at` stamps.
- All schedules run in `Africa/Johannesburg`. Store UTC, present local.

## Build order

1. Core `/webhook` with signature + dedupe (done) and the local chat loop (`npm run chat`).
2. `reminders`: implement `runReminders` in `src/cron.ts` (select due rows, render pack template,
   send, stamp) and the n8n schedule that calls `/cron/reminders`.
3. `followup`, `reactivation`, `waitlist`.
