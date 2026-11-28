# Go-live runbook (Phase 4)

Take one practitioner (Meridian) live on real WhatsApp. Owner: Somila (deploy, config and sign-off).
Read `../BUILD.md` and `../n8n/ARCHITECTURE.md` first.

Inbound goes direct to the Core's `/webhook`; n8n runs the reminders schedule against the
same Core. Nothing here changes code; it is configuration and deployment.

## 0. Preconditions

- Phases 1 to 3 code merged. `npm run typecheck` clean.
- A Supabase project exists and `src/db/schema.sql` is applied.
- A Google service account with Calendar access, shared on the practice calendar.
- A Meta WhatsApp Business account with a phone number.

## 1. Prepare the client config

- In `clients/meridian.json`, set `channels.whatsappNumberId` to the real WhatsApp
  phone number id (not `REPLACE_ME`). This is what routes inbound messages to this client.
- Confirm hours, services and prices are correct. Money is ZAR, no em dashes.

## 2. Deploy the Core

The Core is `src/server.ts` (Express). It needs a public HTTPS URL and to stay running.

- Build the image from the `Dockerfile` and deploy to any container host (Render, Railway,
  Fly, a VPS). Expose port `PORT` (default 3000) behind HTTPS.
- Set the environment (see `.env.example`). Run `npm run check:env` on the host first; it
  exits non-zero if anything required is missing.
- Confirm `GET /healthz` returns `{"ok":true}` over HTTPS.

Required env: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `WHATSAPP_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`,
`GOOGLE_CALENDAR_ID`, `N8N_WEBHOOK_SECRET`, and either `GOOGLE_SERVICE_ACCOUNT_JSON` or
`GOOGLE_APPLICATION_CREDENTIALS` (the path to the service account key file on the host).

With Supabase and Google env set, the Core auto-selects the Supabase store and the Google
Calendar backend. With WhatsApp env set, it sends via the WhatsApp notifier.

## 3. Connect Meta WhatsApp

- In the Meta app dashboard, set the webhook callback URL to `https://<your-host>/webhook`
  and the verify token to the value of `WHATSAPP_VERIFY_TOKEN`. Subscribe to `messages`.
- Meta sends a GET handshake; the Core echoes `hub.challenge` when the token matches. A green
  tick means the webhook is verified.
- `WHATSAPP_APP_SECRET` (Meta app secret) is what the Core verifies each POST against.

## 4. Submit the reminder and follow-up templates

Reminders are sent outside WhatsApp's 24-hour window, so Meta requires an approved template.
Each client has their own WhatsApp number (their own WABA), so bake the business name into the
body and keep four parameters in this order: name, service, date, time. This matches the
Core's `Notifier` params `[name, service, date, time]`.

- Name: `appointment_reminder` (must match the pack's template name)
- Category: Utility
- Language: English
- Body:

  ```
  Hi {{1}}, a reminder of your {{2}} at Meridian Physiotherapy on {{3}} at {{4}}. Reply here if you need to change it.
  ```

Submit it in Meta Business Manager and wait for approval before relying on reminders.
(For a different client, change the baked business name and submit under their WABA.)

Submit `appointment_followup` as a Utility template in English. The two body parameters
are the customer name and service, in that order.

```text
Hi {{1}}, thank you for attending your {{2}} at Meridian Physiotherapy. If you have a question about this appointment, reply here.
```

### Show both messages in a Meridian demo

Run `npm run demo:notifications` to preview a fictional reminder and follow-up in a few
seconds. This advances the clock for the two scheduled jobs and uses an in-memory booking.
For delivery to WhatsApp, wait for both templates to be approved and set
`MERIDIAN_DEMO_RECIPIENT` in the ignored local `.env` to your own approved recipient in
international format (including `+`). Then run `npm run demo:notifications -- --whatsapp`.
The live option uses the Meridian Meta test sender and sends one reminder followed by one
follow-up. It leaves Supabase and Google Calendar booking records untouched.

## 5. Turn on reminders and follow-ups in n8n

- Open the `C7 Reminders` workflow (n8n id `otPtBLVUlBLj59Zs`).
- Set `$env.CORE_BASE_URL` to the deployed Core URL.
- Configure the `C7 Core Shared Secret` credential (httpTemplatedCustomAuth, header
  `X-C7-Secret` = `N8N_WEBHOOK_SECRET`).
- Publish (activate) the workflow.
- Apply the same Core URL and credential to `C7 Follow-up` (n8n id `6GNo7z13BuHHqfgG`)
  and publish it after Meta approves the follow-up template.

## 6. Verification checklist

- [ ] `GET /healthz` is 200 over HTTPS.
- [ ] Meta webhook shows verified (GET handshake passed).
- [ ] A test WhatsApp message to the number gets a reply (inbound path works).
- [ ] A signature check: a POST without a valid `X-Hub-Signature-256` is rejected (401).
- [ ] Booking a slot in chat creates a real Google Calendar event and an `engagements` row.
- [ ] `check_availability` reflects real busy times from the calendar.
- [ ] A due booking triggers exactly one reminder on the next hourly run, and `reminder_sent_at`
      is stamped (a second run sends nothing).
- [ ] `/cron/reminders` rejects calls without the shared secret (401).

## 7. Rollback

- Deactivate the Meta webhook subscription (stops inbound) and unpublish the n8n reminders
  workflow (stops outbound). The Core can keep running; no customer traffic reaches it.

## Practitioner notifications

Daily schedules and appointment change alerts are described in [PRACTITIONER-UPDATES.md](PRACTITIONER-UPDATES.md). Apply its notification migration and approve its two dedicated templates before relying on delivery. The local pilot worker is `npm run practitioner:run`, and hosted orchestration calls `/cron/practitioner` every minute.
