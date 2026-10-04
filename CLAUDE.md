# Working rules for Claude Code

Read this before changing anything. `BUILD.md` is the full platform spec; `n8n/ARCHITECTURE.md` is how n8n and the Core fit together.

## Architecture in one line
One vertical-agnostic Core. Each vertical is a Pack under `verticals/`. Each client is a Config (JSON). Business data never enters code; vertical logic never enters a client config.

## Hard rules
- The model never invents availability. Open times come only from `check_availability`, which reads config hours and the booking backend.
- `book_appointment` re-validates the slot against the backend before writing. Never trust the model's tool arguments.
- Keep the fixed system prompt stable so prompt caching hits. Only the config block interpolates.
- Pin the model with `CLAUDE_MODEL` (default Haiku). Cap tool rounds with `MAX_TOOL_ROUNDS`. Log token usage per conversation.
- All times are timezone-aware (`Africa/Johannesburg` by default from config). Store UTC, present local.
- Money is ZAR. No em dashes in any customer-facing copy.
- Adding a vertical is a new folder under `verticals/`, never an edit to Core control flow. If Core must change, change it once for all verticals.
- Inbound webhooks are verified (Meta HMAC over the raw body) and deduped (`claimMessage` on the provider message id). Never process an unverified or already-seen message.
- n8n is triggers and transport only; the Core owns all logic. n8n calls the Core `/cron/*` endpoints on a clock. Inbound goes direct to `/webhook`.
- Secrets only in env. Never commit `.env` or a live config with a real token.

## Where things live
- `src/brain/` the Core brain: system prompt, tools, Claude loop.
- `src/booking/` the booking backend adapter and implementations (memory for dev, Google Calendar for prod), plus availability.
- `src/db/` the store interface and implementations (memory for dev, Supabase for prod), schema, and inbound dedupe.
- `src/channel/` WhatsApp Cloud API: send, receive, signature verification.
- `src/handler.ts` ties a message to a reply. `src/server.ts` the webhook and `/cron/*`. `src/cron.ts` the scheduled jobs.
- `verticals/<name>/` the pack: pack.json + prompt.md. `service/` is the generic starter to copy.
- `clients/` client configs (`meridian.json`, `harbour.json` are references, `_template.json` the blank).
- `src/config/store.ts` the config source of truth: the `businesses` table when Supabase is set,
  else the `clients/` files. Onboard or update a client with `npm run onboard -- <config.json>`.
- `n8n/` the scheduled workflows and the architecture doc.

## Dev path
`npm install` then `npm run chat` with only `ANTHROPIC_API_KEY` set. It runs the brain against an in-memory store and an in-memory calendar seeded from the Meridian config. No WhatsApp, Supabase or Google needed to iterate on the conversation.
