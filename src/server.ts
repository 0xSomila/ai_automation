import "dotenv/config";
import express from "express";
import { handleMessage, type Deps } from "./handler";
import { MemoryStore } from "./db/memory";
import { MemoryBackend } from "./booking/memory";
import { parseInbound, sendText, verifySignature } from "./channel/whatsapp";
import { MemoryNotifier, WhatsAppNotifier } from "./channel/notifier";
import { runReminders, runFollowup, runReactivation, runWaitlist, type CronResult } from "./cron";

// Choose real implementations when their env is set, else dev stubs.
async function buildDeps(): Promise<Deps> {
  let store;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const { SupabaseStore } = await import("./db/supabase");
    store = new SupabaseStore();
  } else {
    store = new MemoryStore();
  }
  let backend;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_CALENDAR_ID) {
    const { GoogleCalendarBackend } = await import("./booking/googleCalendar");
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
// Capture the exact raw body so the Meta HMAC signature can be verified over it.
app.use(express.json({ verify: (req, _res, buf) => ((req as any).rawBody = buf) }));

// Meta webhook verification handshake.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  // Verify Meta's signature over the raw body before trusting anything. Skip only
  // when no app secret is configured (local dev), so the signature stays enforced
  // in every environment that sets WHATSAPP_APP_SECRET.
  if (process.env.WHATSAPP_APP_SECRET) {
    const ok = verifySignature((req as any).rawBody ?? "", req.header("x-hub-signature-256"));
    if (!ok) return res.sendStatus(401);
  }
  res.sendStatus(200); // ack fast; Meta retries on non-200

  try {
    const inbound = parseInbound(req.body);
    if (!inbound) return;
    const deps = await buildDeps();

    // Dedupe: Meta re-delivers. Process each provider message id at most once.
    const businessId = DEFAULT_SLUG; // TODO multi-tenant: resolve by inbound.phoneNumberId
    const fresh = await deps.store.claimMessage(businessId, inbound.messageId);
    if (!fresh) return;

    const reply = await handleMessage(deps, {
      businessSlug: DEFAULT_SLUG,
      from: inbound.from,
      text: inbound.text,
    });
    await sendText(inbound.from, reply);
  } catch (e) {
    console.error("inbound error:", (e as Error).message);
  }
});

// Scheduled jobs, triggered by the n8n schedule workflows. Guarded by a shared
// secret header so only n8n can invoke them. See n8n/ARCHITECTURE.md.
const cronJobs: Record<string, (deps: Deps) => Promise<CronResult>> = {
  reminders: runReminders,
  followup: runFollowup,
  reactivation: runReactivation,
  waitlist: runWaitlist,
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
    return res.status(200).json({ ok: true, result });
  } catch (e) {
    console.error(`cron ${req.params.job} failed:`, (e as Error).message);
    return res.status(500).json({ ok: false, error: "cron_failed" });
  }
});

app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Automation OS webhook on :${port}`));
