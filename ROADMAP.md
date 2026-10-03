# C7 Automation OS: build phases

The path from where the code is now to a live, multi-client platform. Each phase has a
goal, the work, and a clear "done when". Ship phase by phase; do not start a phase before
its predecessor's "done when" holds.

Delivery cell: Somila (lead), Tshiamo (build), Themba (config and sign-off).
Read `CLAUDE.md` for the rules, `BUILD.md` for the spec, `n8n/ARCHITECTURE.md` for orchestration.

---

## Where we are now (done)

- `src/` Core with dependency injection: `Store` and `BookingBackend` interfaces, each with a
  memory impl (dev) and a production impl (Supabase, Google Calendar) auto-selected by env.
- Local dev loop: `npm run chat` runs the real tool loop against in-memory adapters.
- `book_appointment` fully works (re-validates the slot, writes, persists, returns a reference).
- Inbound hardening: Meta HMAC signature verification + dedupe (`processed_messages`).
- `/webhook` (inbound) and secret-guarded `/cron/*` routes exist; four vertical packs.
- n8n inbound workflow built (optional); cron handlers are stubs.

So the brain books, locally. Nothing is hosted; no real DB, calendar, or WhatsApp.

---

## Phase 1 — Harden the conversation (local, no external services) — DONE (runner + token logging shipped; practitioner case is the live gate)

**Goal:** trust the brain before wiring anything. This is the loop that de-risks everything.

- Write a small runner for `test/conversations/*.json` against the handler with a deterministic
  in-memory backend (assert `expectTool` and `expectReply`).
- Add token-usage logging per conversation (CLAUDE.md rule).
- Tighten the practitioner prompt and the two tools until the scripted cases pass reliably.

**Done when:** `npm run chat` handles the practitioner cases cleanly and the scripted runner is green.
**Needs no external accounts.**

---

## Phase 2 — Reminders end to end (first scheduled job) — DONE (template layer, runReminders, n8n C7 Reminders schedule; test:reminders green)

**Goal:** the first automation that runs on a clock, and the decision it forces: where message
templates live.

- Add a **template layer per vertical pack** (bodies for `appointment_reminder` etc.), rendered
  by the Core with config + engagement data. The packs list template names today but hold no bodies.
- Add a `Store` query for due reminders (confirmed, inside the window, `reminder_sent_at` null).
- Implement `runReminders` in `src/cron.ts`: select, render, send, stamp.
- Build the n8n `reminders` schedule calling `POST /cron/reminders`.

**Done when:** a seeded due booking produces exactly one reminder and gets stamped; a second run sends nothing.
**Decision gate:** template format (plain strings with placeholders vs WhatsApp approved templates).

---

## Phase 3 — Production data and calendar — CODE DONE (multi-tenant routing + calendar backend hardened; live verification pending a Supabase project and a Google service account)

**Goal:** swap dev adapters for real ones, no brain changes (that is the point of the interfaces).

- Create a Supabase project, apply `src/db/schema.sql`, set `SUPABASE_*`. `SupabaseStore` activates by env.
- Implement the Google Calendar backend (`getBusy`, `createEvent`, `cancelEvent`); set `GOOGLE_*`.
- Add multi-tenant lookup: resolve the inbound `phone_number_id` to a client slug (replace the
  `DEFAULT_CLIENT_SLUG` shortcut in `server.ts`); seed the `businesses` row.

**Done when:** a booking made in chat (pointed at Supabase + Calendar) appears in the real calendar
and the `engagements` table, and availability reflects real busy times.
**Needs:** Supabase account, a Google service account + calendar.

---

## Phase 4 — Go live with one practitioner (Meridian) — DEPLOY KIT READY (Dockerfile, check:env preflight, docs/GO-LIVE.md; execution needs the host + Meta accounts)

**Goal:** one real business answering real WhatsApp messages.

- Host the Core (`src/server.ts`) somewhere with a public HTTPS URL and always-on (VPS, Render,
  Railway, or a container host). Set all env incl. `WHATSAPP_APP_SECRET`.
- Meta WhatsApp Cloud API: connect the number, point the webhook at the hosted `/webhook`, pass the
  verify handshake, submit the reminder message template for approval.
- Deploy the n8n `reminders` schedule against the live Core.
- Run the go-live checklist: verify signature, dedupe, a real booking, and a real reminder.

**Done when:** a real customer can message the number, book, and receive a reminder; Themba signs off.
**Needs:** a host, the Meta WhatsApp account, a real (or pilot) client number.

---

## Phase 5 — Complete the tool set and the scheduled family

**Goal:** full appointment lifecycle and the rest of the nudges.

- Tools: `reschedule` and `cancel` (re-validate like `book_appointment`; `cancel` releases the slot).
- Scheduled jobs: `followup` (daily), `reactivation` (weekly), `waitlist` (in-process on cancel, plus
  the ~15 min safety-net `/cron/waitlist`).
- Their n8n schedules.

**Done when:** a customer can reschedule and cancel over WhatsApp, and follow-up/reactivation fire correctly.

---

## Phase 6 — Second vertical (restaurant or salon, whichever has a live prospect)

**Goal:** prove the platform claim: a new vertical is a pack, not a new app.

- Implement the resource-model override the vertical needs: **covers** (restaurant) or **per-staff**
  (salon) availability. Today both fall back to single-resource.
- Add the vertical's extra intents/entities and templates. Do not touch Core control flow; if Core
  must change, change it once for all verticals (CLAUDE.md).
- Onboard one client config and run its scripted conversations.

**Done when:** the second vertical books correctly against its own resource model, with Core unchanged
beyond shared additions. Target: a new pack in days, a new client on an existing pack in hours.

---

## Phase 7 — Scale: many clients, admin, observability

**Goal:** run several businesses without per-client engineering.

- Config admin (Vercel) to create/edit client configs and seed `businesses` without hand-editing JSON.
- Observability: per-conversation logs, token spend, delivery/failure dashboards, cron run results.
- Onboarding runbook so Themba can stand up a client from the template in hours.

**Done when:** a new client on an existing pack goes live from config alone, no code change.

---

## The gates between phases

1. Brain trusted locally (P1) before any external wiring.
2. Templates decided (P2) before go-live.
3. Real data + calendar proven (P3) before exposing a public webhook (P4).
4. One client stable (P4) before adding tools/jobs (P5) or a second vertical (P6).

Each phase is shippable on its own. If a vertical stalls commercially, the Core and the other
packs still stand.
