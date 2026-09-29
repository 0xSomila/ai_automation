# n8n orchestration architecture

Reference for the delivery cell (Somila lead, Tshiamo build, Themba config and sign-off).
Read `../CLAUDE.md` and `../BUILD.md` first. This document says how n8n and the Core fit together.

## Governing principle: n8n is triggers and transport, the Core owns all logic

Vertical logic never enters n8n (CLAUDE.md). Message templates live in the vertical pack,
availability lives in the pack, the brain lives in the Core. So n8n does not render templates,
decide availability, or run the tool-loop. Every workflow is thin:

```
trigger  ->  call a Core HTTP endpoint  ->  log the result
```

All the thinking happens behind that endpoint, where the pack and client config are already loaded.
This keeps the same guarantees if n8n is ever swapped for another orchestrator.

## The Core HTTP surface (core/server.ts)

A small always-on service wraps the existing `handler.ts` plus the scheduled jobs. n8n calls it.
Every call carries a shared secret header (`X-C7-Secret`, value `N8N_WEBHOOK_SECRET`); the Core
rejects anything without it.

| Endpoint | Called by | Does |
| --- | --- | --- |
| `GET /healthz` | uptime checks | liveness |
| `POST /inbound` | `inbound` workflow | verify Meta HMAC signature, dedupe on message id, parse, run the brain, reply, persist |
| `POST /cron/reminders` | `reminders` workflow | send due reminders, stamp `reminder_sent_at` |
| `POST /cron/followup` | `followup` workflow | send due follow-ups, stamp `followup_sent_at` |
| `POST /cron/reactivation` | `reactivation` workflow | message lapsed customers |
| `POST /cron/waitlist` | `waitlist` safety-net workflow | release freed slots to waitlisted customers |

```
Meta WhatsApp Cloud API
        |  webhook: GET verify (handled in n8n), POST messages
        v
   n8n inbound workflow  --- respond 200 in <1s ---> Meta
        |  POST raw body + X-Hub-Signature-256 + X-C7-Secret
        v
   Core /inbound  ->  handler.ts  ->  Supabase + WhatsApp send + booking backend
```

## Workflow 1: inbound (the spine)

Trigger: n8n Webhook node, one URL, registered with Meta for both GET and POST.

1. Webhook (GET + POST, same path).
2. IF: is this the GET verify handshake (`hub.mode == subscribe`)?
   - Yes: respond with `hub.challenge` when `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`. Done.
   - No: continue.
3. Respond to Webhook with `200 OK` immediately. Meta retries and disables slow webhooks, so
   acknowledge first, process after.
4. HTTP Request to Core `POST /inbound`, forwarding the raw JSON body, the `X-Hub-Signature-256`
   header, and the `X-C7-Secret` header.
5. The Core verifies the signature, dedupes on the provider message id (Meta re-delivers), looks up
   the business by `phoneNumberId`, loads pack + config, runs the brain, sends the reply, persists.

Error handling: the customer-facing failure path lives inside `handler.ts` (it sends the "technical
issue" message). n8n does not retry `/inbound`, because a retry would double-reply. n8n logs failures.

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

- Core base URL and the shared secret (`N8N_WEBHOOK_SECRET`).
- WhatsApp verify token, for the GET handshake in n8n.
- No Supabase or Claude keys in n8n. Those live in the Core env. That is the point.

## Idempotency and timezone

- Inbound: dedupe on the Meta message id (`processed_messages` table).
- Scheduled: the `*_sent_at` stamps.
- All schedules run in `Africa/Johannesburg`. Store UTC, present local.

## Build order

1. `core/server.ts` + `inbound` workflow (proves an end-to-end live message).
2. `reminders`.
3. `followup`, `reactivation`, `waitlist`.
