# n8n workflows

Self-hosted / cloud n8n orchestrates the channel and the scheduled workflows.
Read `ARCHITECTURE.md` for how n8n and the Core fit together.

After the merge to the `src/` Core, **inbound WhatsApp goes direct to the Core's own
`/webhook`** (verify, signature, dedupe, brain). n8n's job is the **scheduled jobs**, each
calling a Core `/cron/*` endpoint on a clock. Build them in the n8n SDK, then replace the
JSON skeleton with a `.workflow.ts`.

| Source | Trigger | Status | Does |
| --- | --- | --- | --- |
| `reminders.workflow.ts` | Schedule (hourly) | Built (n8n id `otPtBLVUlBLj59Zs`) | Call Core `/cron/reminders`. |
| `followup.workflow.ts` | Schedule (daily 09:00) | Built (n8n id `6GNo7z13BuHHqfgG`) | Call Core `/cron/followup`. |
| `reactivation.workflow.ts` | Schedule (weekly Mon 09:00) | Built (n8n id `x5GJVKS16xbAhNE3`) | Call Core `/cron/reactivation`. |
| `waitlist.workflow.ts` | Schedule (~15 min) | Built (n8n id `p318TJhr6QerzWdD`) | Call Core `/cron/waitlist` (safety-net release when a slot frees). |
| `inbound.workflow.ts` | WhatsApp webhook | Optional (n8n id `M8LcXtQ3X8YXzzi1`) | Alternative n8n inbound front; not required now that `/webhook` is direct. Can stay inactive. |

Each schedule workflow needs, in n8n: `$env.CORE_BASE_URL` and a credential carrying the
`X-C7-Secret` header (= `N8N_WEBHOOK_SECRET`). No Supabase, Claude or WhatsApp keys in n8n.

All times are `Africa/Johannesburg`. Store UTC, present local. Never commit real
credentials; n8n credential references only.
