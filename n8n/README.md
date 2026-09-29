# n8n workflows

Self-hosted / cloud n8n orchestrates the channel and the scheduled workflows.
Read `ARCHITECTURE.md` for how n8n and the Core fit together.

Built workflows are kept as n8n Workflow SDK source (`*.workflow.ts`), the source
of truth, and deployed to n8n via the n8n MCP. Not-yet-built ones remain as JSON
skeletons: build them in the SDK, then replace the skeleton with a `.workflow.ts`.

| Source | Trigger | Status | Does |
| --- | --- | --- | --- |
| `inbound.workflow.ts` | WhatsApp webhook | Built (n8n id `M8LcXtQ3X8YXzzi1`) | GET verify handshake; POST acks 200 then forwards raw body + signature to Core `/inbound`. |
| `reminders.json` | Schedule (hourly) | Skeleton | Call Core `/cron/reminders`. |
| `followup.json` | Schedule (daily) | Skeleton | Call Core `/cron/followup`. |
| `reactivation.json` | Schedule (weekly) | Skeleton | Call Core `/cron/reactivation`. |
| `waitlist.json` | Schedule (~15 min) | Skeleton | Call Core `/cron/waitlist` (safety net; primary release is in-process). |

Before the inbound workflow goes live, configure in n8n: `$env.CORE_BASE_URL`,
`$env.WHATSAPP_VERIFY_TOKEN`, and the `C7 Core Shared Secret` credential
(httpTemplatedCustomAuth, header `X-C7-Secret` = `N8N_WEBHOOK_SECRET`). Then publish.

All times are `Africa/Johannesburg`. Store UTC, present local. Never commit real
credentials; n8n credential references only.
