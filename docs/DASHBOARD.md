# Practice dashboard

Run `npm run dev`, then open http://localhost:3000/dashboard/.

The local preview on 24 November 2026 runs at http://127.0.0.1:3100/dashboard/. The pilot connection was enabled and existing booking references and statuses were verified in the browser. The local Core remains on port 3100.

The first version uses the approved forest green and warm-white concept. Its default workspace is a fictional Meridian demonstration. Demo actions stay in browser memory, reset on reload and do not call WhatsApp, Google Calendar or Supabase.

## Walkthrough

1. Open the day calendar and switch practitioner or date. Week view shows the following seven days.
2. Click a booking for its details and persistent reference. Try moving or cancelling a demo booking. The move form checks full appointment overlap against other demo bookings and today's sample leave block.
3. Click **Try the WhatsApp demo**, then **Run the demo**. Casey's booking moves from 10:00 to 14:00, its reference stays C7-DEMO, and a practitioner notification preview appears.
4. Open Inbox to read the fictional conversation. **Preview takeover** enables a browser-only team reply. No actual AI pause or WhatsApp reply is implemented in the dashboard.
5. Reset demo to restore the starting records.

## Read-only pilot connection

For this local pilot, `DASHBOARD_LOCAL_ACCESS=true` is set in the gitignored `.env`. Open the dashboard on `127.0.0.1` or `localhost` and choose **Connect pilot**. The server creates an eight-hour HttpOnly, SameSite=Strict session cookie after checking the loopback peer, local Host, exact same Origin and absence of proxy/forwarding headers. This connection is refused through the public tunnel. No credential needs to be copied into the page. Reloading reconnects an existing session; **Back to demo** revokes it. Restarting the Core invalidates sessions, so click **Connect pilot** again.

For optional remote access, set `DASHBOARD_ACCESS_TOKEN` to a separate cryptographically random value of at least 32 characters, and use the token form. Set `DASHBOARD_CLIENT_SLUG` to the intended business (default `meridian`). Never enter Supabase or Meta credentials in the dashboard.

The API requires either a valid server-side session or the separate dashboard bearer token. The browser holds an entered bearer token in memory only and passes it in the Authorization header. It does not persist tokens or pilot booking data in browser storage. Use HTTPS for remote access. This is a single-workspace pilot access mechanism; individual staff accounts and roles remain future work.

The endpoint returns up to 500 appointment records for seven days starting at the chosen SAST date, scoped on the server to one business. It includes patient booking names, service, resource, reference, date/time, status and reminder submission state. It does not return phone numbers, customer identifiers, chat contents, service keys or business configuration. The UI polls every 30 seconds while visible and connected. A failed refresh keeps the last successful snapshot, with a visible error and last-loaded time.

Pilot inbox and write actions remain unavailable. No assignment to fictional practitioners is inferred: records without a resource use **Practice calendar**. The calendar currently displays 08:00–17:00; the Appointments view includes records outside that range. Multi-practitioner calendar routing, live human handover and delivery receipts are separate integrations.

## Validation

`npm run typecheck` and `npm run test:dashboard`. The dashboard test uses a temporary local Express listener with no pilot credentials and checks closed-by-default access, token validation, date validation, security headers and absence of write endpoints.

Chrome walkthrough verified the day/week views, practitioner filtering, reference search, full-duration demo conflict feedback, successful move with the same reference, cancellation with the slot reopened, WhatsApp scenario and browser-only handover reply. Desktop and 390px phone layouts were inspected. Lifecycle, reminders, routing, covers and practitioner tests also passed using isolated test fixtures. The pilot read endpoint was checked with a stubbed database transport for business scope and SAST date range before the real browser verification below.

On 24 November the real local session and database connection were verified in the browser. The 18–24 November snapshot included C7-GV6C and C7-BYWI as cancelled, C7-TT1H as confirmed, and the synthetic practitioner test C7-R9QI as cancelled. Older records without a captured booking name show **Booked patient**. No real bookings were changed during this read-only verification.

A fresh user-sent WhatsApp booking was then verified end to end: **C7-DHG5**, Avery Testwell, initial consultation on **25 November 2026 at 10:00 SAST**, 45 minutes. Supabase recorded it as confirmed, the linked Google Calendar event had matching start and duration, and the live dashboard displayed the patient, time, status and same reference in both calendar and appointment details. The booking was left in place. Reloading the dashboard also reconnected the existing local session. This verifies the patient-to-booking-to-dashboard flow; live practitioner receipt, dashboard write actions and live inbox handover remain separate checks.

## WhatsApp-only public ingress

`src/webhookIngress.ts` forwards only exact `/webhook` GET and POST requests to the local Core. All dashboard, cron, operations and other routes return 404 at the ingress. Raw request bytes and the Meta signature are preserved. The listener binds to loopback; start with `WEBHOOK_CORE_PORT=3100` and `npm run webhook:ingress` (default ingress port 3101).

The current temporary Cloudflare tunnel targets port 3101. Meta accepted the updated callback for the existing Meridian test account and completed verification. Public dashboard and operations paths were checked and returned 404. This replaces the expired tunnel for the pilot without exposing the dashboard. The processes and temporary URL still depend on this computer staying awake and connected.

Run `npm run test:webhook-ingress` for route isolation and raw-body forwarding checks. The dashboard tests also cover local session opt-in, same-origin checks, tunnel/forwarding rejection, logout and bearer authentication.
