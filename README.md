# C7 Automation OS

AI receptionist for appointment and reservation businesses. One engine, many verticals (practitioner, restaurant, salon, generic service). The model runs on the Claude Messages API with your own key.

Built by Catalyst 7. Delivery cell: Somila (lead, config and sign-off), Tshiamo (build).

## Quick start (talk to it in your terminal, no WhatsApp needed)

```bash
npm install
cp .env.example .env        # put your ANTHROPIC_API_KEY in
npm run chat
```

This runs the brain against an in-memory store and an in-memory calendar seeded from `clients/meridian.json` (a fictional physio practice). Type messages and watch it qualify, check availability and book, running the real tool loop. This is the loop you harden before wiring any channel.

## What is here

- `src/brain/` the Core: `systemPrompt.ts` (built from a client config), `tools.ts` (the two booking tools and their executors), `claude.ts` (the Messages API loop with prompt caching, a model pin and a tool-round cap).
- `src/booking/` `adapter.ts` (the backend interface), `memory.ts` (dev calendar), `googleCalendar.ts` (production), `availability.ts` (slot computation).
- `src/db/` `types.ts` (store interface), `memory.ts` (dev), `supabase.ts` (production), `schema.sql`.
- `src/channel/whatsapp.ts` WhatsApp Cloud API send, receive, and signature verification.
- `src/db/` also carries inbound dedupe (`claimMessage` + the `processed_messages` table).
- `src/handler.ts` message in, reply out.
- `src/server.ts` the WhatsApp webhook (Express): Meta verify handshake, signature check, dedupe, and the `/cron/*` endpoints for the scheduled jobs.
- `src/cron.ts` the scheduled job handlers (reminders, follow-up, reactivation, waitlist).
- `verticals/practitioner/` the first pack. `restaurant/`, `salon/` and `service/` (the generic starter) follow the same shape.
- `clients/meridian.json` the reference config; `clients/_template.json` the blank.
- `BUILD.md` the full platform spec. `n8n/ARCHITECTURE.md` how n8n and the Core fit together.

## From dev to production

1. Apply `src/db/schema.sql` to a Supabase project and set `SUPABASE_*`. `server.ts` auto-selects the Supabase store when those are set, the memory store otherwise.
2. Set `GOOGLE_*`; `server.ts` auto-selects the Google Calendar backend.
3. Set `WHATSAPP_*` (including `WHATSAPP_APP_SECRET` for signature checks), point the Meta webhook straight at `/webhook` on your deployed `server.ts`, submit the message templates.
4. n8n runs the scheduled jobs only: it calls the Core `/cron/*` endpoints (guarded by `N8N_WEBHOOK_SECRET`) on a clock. Inbound messages go direct to `/webhook`; n8n is not in that path. See `n8n/ARCHITECTURE.md`. A standalone n8n inbound front (`n8n/inbound.workflow.ts`) exists as an optional alternative if you want n8n to own the external surface.

### Deploying

The Core ships as a container (`Dockerfile`), run with `npm start` (tsx over the source, so the
`clients/` and `verticals/` asset paths resolve as in dev). Run `npm run check:env` on the host to
verify the production environment before cutover. The full go-live steps (host, Meta WhatsApp
webhook, reminder template, n8n schedule, verification checklist) are in `docs/GO-LIVE.md`.

## Adding a vertical

Copy `verticals/practitioner/`, change `pack.json` intents and entities, write the `prompt.md` fragment, and add an availability override only if its resource model differs (restaurant uses covers, salon uses per-staff). Do not touch Core.
