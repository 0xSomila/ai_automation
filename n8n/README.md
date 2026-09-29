# n8n workflows

Self-hosted n8n (Docker) orchestrates the channel and the scheduled workflows.

The n8n MCP connector is currently down, so build and import these via the n8n
UI or REST API. Each file here is an export skeleton: import it, wire the
credentials (Supabase, WhatsApp, the webhook secret), then re-export over the
file so the repo stays the source of truth.

| File | Trigger | Does |
| --- | --- | --- |
| `inbound.json` | WhatsApp webhook | Verifies the signature, parses the message, calls the Core handler. |
| `reminders.json` | Schedule (hourly) | Finds engagements starting soon with no `reminder_sent_at`, sends the reminder, stamps it. |
| `followup.json` | Schedule (daily) | Finds completed engagements with no `followup_sent_at`, sends the follow-up, stamps it. |
| `reactivation.json` | Schedule (weekly) | Finds lapsed customers, sends the reactivation template. |
| `waitlist.json` | Schedule / event | On a cancellation, releases the slot to the next waitlisted customer. |

All times are `Africa/Johannesburg`. Store UTC, present local. Never commit real
credentials in these exports; n8n credential references only.
