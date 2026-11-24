# Vercel deployment

The repository deploys the Express app in `src/server.ts`. Vercel serves `public/` assets and includes the client and vertical pack files. `/` redirects to `/dashboard/`; the privacy notice remains at `/privacy/meridian-booking-pilot`.

The Vercel project is `catalyst-7/c7-automation-os`, with production at https://c7-automation-os.vercel.app. It tracks `codex/meridian-booking-pilot`; draft PR #2 contains the release. Source uses explicit `.js` relative imports with TypeScript NodeNext resolution so emitted code also works in Vercel's native ESM runtime. The model client is created only for a conversation, allowing health/privacy/demo routes to start without live model credentials.

## Runtime and secrets

Use Node 22 and the repository root. `vercel.json` sets the Express framework, runs TypeScript validation and allows the function up to 300 seconds. Signed WhatsApp webhooks are acknowledged immediately and their processing promise is registered with Vercel's `waitUntil` helper. This preserves the existing model/tool/database/Calendar/send flow after the response. This is bounded background execution, not a durable job queue.

Configure these as Vercel environment variables, never as Git files:

- `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `MAX_TOOL_ROUNDS`
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`
- `GOOGLE_CALENDAR_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` (inline key JSON, since the Windows credential file is unavailable on Vercel)
- `DEFAULT_CLIENT_SLUG=meridian`, `DASHBOARD_CLIENT_SLUG=meridian`
- `DASHBOARD_ACCESS_TOKEN`: separate cryptographically random secret, at least 32 characters
- `DASHBOARD_LOCAL_ACCESS=false`
- `N8N_WEBHOOK_SECRET` if remote scheduled jobs will be enabled

The hosted demo is public. Actual booking data requires the dashboard bearer token. Enter it through **Connect pilot**; the browser keeps it in memory only. Local HttpOnly sessions are not a hosted login method and should remain disabled in production. Individual staff accounts and role-based access remain future work.

## Verify and cut over

1. Deploy the branch, check `/healthz`, the dashboard HTML/CSS/JS and privacy notice.
2. Confirm unauthenticated `/dashboard/api/appointments` is refused and a local-session POST cannot authenticate remotely.
3. Configure environment variables; redeploy. Check an authenticated read against a known reference and Calendar event.
4. Only after the hosted checks pass, update the existing Meridian test account's webhook callback to the stable production domain plus `/webhook`, retaining the verification token.
5. Send a fictional WhatsApp booking and confirm its reference, timestamp and duration in Supabase, Calendar and the hosted dashboard. Then test moving and cancellation through WhatsApp.

Keep the local Core and webhook-only ingress available until the new callback is verified. Roll back by restoring the previously verified callback and Vercel deployment. No database migration is required specifically for the dashboard or Vercel adapter; practitioner queue migrations already applied to the pilot are part of this repository's history.

## Scheduling

This deployment does not silently enable cron jobs. Reminders, follow-up and practitioner summaries require an authenticated external schedule calling the existing `/cron/:job` endpoints, or a separately configured Vercel schedule. The Windows practitioner task still depends on the computer. Migrating that task and retention cleanup is separate from publishing the dashboard and webhook.
