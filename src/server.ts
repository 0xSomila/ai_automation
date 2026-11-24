import "dotenv/config";
import express from "express";
import { waitUntil } from "@vercel/functions";
import { dashboardRouter } from "./dashboard.js";
import { fileURLToPath } from "node:url";
import { handleMessage, type Deps } from "./handler.js";
import { MemoryStore } from "./db/memory.js";
import { MemoryBackend } from "./booking/memory.js";
import { parseInbound, sendText, verifySignature } from "./channel/whatsapp.js";
import { getConfig, resolveBusiness } from "./config/store.js";
import { dispatchPractitionerNotices, runPractitionerUpdates } from "./practitioner.js";
import { MemoryNotifier, WhatsAppNotifier } from "./channel/notifier.js";
import { runReminders, runFollowup, runReactivation, runWaitlist, type CronResult } from "./cron.js";

// Choose real implementations when their env is set, else dev stubs.
async function buildDeps(): Promise<Deps> {
  let store;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const { SupabaseStore } = await import("./db/supabase.js");
    store = new SupabaseStore();
  } else {
    store = new MemoryStore();
  }
  let backend;
  if (process.env.GOOGLE_CALENDAR_ID || process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const { GoogleCalendarBackend } = await import("./booking/googleCalendar.js");
    backend = new GoogleCalendarBackend();
  } else {
    backend = new MemoryBackend();
  }
  const notifier =
    process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
      ? new WhatsAppNotifier()
      : new MemoryNotifier();
  return { store, backend, notifier };
}

const DEFAULT_SLUG = process.env.DEFAULT_CLIENT_SLUG || "meridian";

const app = express();
app.get("/", (_req, res) => res.redirect("/dashboard/"));
// Capture the exact raw body so the Meta HMAC signature can be verified over it.
app.use(express.json({ verify: (req, _res, buf) => ((req as any).rawBody = buf) }));
app.use("/dashboard", dashboardRouter());

app.get("/privacy/meridian-booking-pilot", (_req, res) => {
  res.sendFile(fileURLToPath(new URL("../public/privacy/meridian-booking-pilot.html", import.meta.url)));
});

// Meta webhook verification handshake.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const verified = Boolean(expectedToken) && token === expectedToken && typeof challenge === "string";
  if (mode === "subscribe") {
    console.info(`[whatsapp] ${new Date().toISOString()} webhook verification ${verified ? "accepted" : "rejected"}`);
  }
  if (mode === "subscribe" && verified) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

async function processInbound(body: unknown): Promise<void> {
  try {
    const inbound = parseInbound(body);
    if (!inbound) return;
    // Replies use the configured sender. Ignore events for other Meta numbers.
    const senderNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (senderNumberId && inbound.phoneNumberId !== senderNumberId) return;
    const deps = await buildDeps();

    // Multi-tenant: route by the number the message arrived on, falling back to
    // the default client when the number is not mapped to a config.
    const slug = (await resolveBusiness(inbound.phoneNumberId)) ?? DEFAULT_SLUG;

    // Dedupe: Meta re-delivers. Process each provider message id at most once.
    const fresh = await deps.store.claimMessage(slug, inbound.messageId);
    if (!fresh) return;

    const reply = await handleMessage(deps, {
      businessSlug: slug,
      from: inbound.from,
      text: inbound.text,
    });
    try {
      await sendText(inbound.from, reply);
    } finally {
      await dispatchPractitionerNotices(deps, await getConfig(slug), 3);
    }
  } catch (e) {
    console.error("inbound error:", (e as Error).message);
  }
}

app.post("/webhook", (req, res) => {
  if (!process.env.WHATSAPP_APP_SECRET ||
      !verifySignature((req as any).rawBody ?? "", req.header("x-hub-signature-256"))) {
    return res.sendStatus(401);
  }
  // Vercel must retain the invocation after Meta's immediate acknowledgement.
  // Signature verification and the stored dedupe remain inside the same flow.
  const task = processInbound(req.body);
  if (process.env.VERCEL) waitUntil(task);
  else void task;
  return res.sendStatus(200);
});

// Scheduled jobs, triggered by the n8n schedule workflows. Guarded by a shared
// secret header so only n8n can invoke them. See n8n/ARCHITECTURE.md.
const cronJobs: Record<string, (deps: Deps) => Promise<CronResult>> = {
  reminders: runReminders,
  followup: runFollowup,
  reactivation: runReactivation,
  waitlist: runWaitlist,
  practitioner: runPractitionerUpdates,
};

app.post("/cron/:job", async (req, res) => {
  const expected = process.env.N8N_WEBHOOK_SECRET;
  if (!expected || req.header("x-c7-secret") !== expected) {
    return res.sendStatus(401);
  }
  const job = cronJobs[req.params.job];
  if (!job) return res.sendStatus(404);
  try {
    const deps = await buildDeps();
    const result = await job(deps);
    await deps.store.recordCronRun(req.params.job, result, new Date().toISOString());
    return res.status(200).json({ ok: true, result });
  } catch (e) {
    console.error(`cron ${req.params.job} failed:`, (e as Error).message);
    return res.status(500).json({ ok: false, error: "cron_failed" });
  }
});

// Lightweight observability: recent scheduled-job runs. Secret-guarded like /cron/*.
app.get("/ops/summary", async (req, res) => {
  const expected = process.env.N8N_WEBHOOK_SECRET;
  if (!expected || req.header("x-c7-secret") !== expected) return res.sendStatus(401);
  try {
    const deps = await buildDeps();
    const runs = await deps.store.recentCronRuns(50);
    return res.status(200).json({ ok: true, runs });
  } catch (e) {
    console.error("ops summary failed:", (e as Error).message);
    return res.status(500).json({ ok: false, error: "ops_failed" });
  }
});

app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

const port = Number(process.env.PORT || 3000);
if (!process.env.VERCEL) app.listen(port, () => console.log(`Automation OS webhook on :${port}`));
export default app;
