/**
 * Core HTTP surface. n8n calls this; the Core owns all logic. See n8n/ARCHITECTURE.md.
 *
 * Endpoints (all POSTs require the shared secret header X-C7-Secret):
 *   GET  /healthz              liveness
 *   POST /inbound             verify signature, dedupe, parse, run the brain, reply
 *   POST /cron/reminders      due reminders           (built in step 2)
 *   POST /cron/followup       due follow-ups          (built in step 3)
 *   POST /cron/reactivation   lapsed customers        (built in step 3)
 *   POST /cron/waitlist       release freed slots     (built in step 3)
 *
 * Kept dependency-free (node:http) so the Core adds no framework weight.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handleInbound } from "./handler.js";
import { parseInbound, verifySignature } from "./channel/whatsapp.js";
import { runReminders, runFollowup, runReactivation, runWaitlist } from "./cron.js";

const PORT = Number(process.env.PORT ?? 8080);

function sharedSecretOk(req: IncomingMessage): boolean {
  const expected = process.env.N8N_WEBHOOK_SECRET;
  if (!expected) throw new Error("N8N_WEBHOOK_SECRET must be set");
  return req.headers["x-c7-secret"] === expected;
}

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  if (method === "GET" && url === "/healthz") {
    return json(res, 200, { ok: true });
  }

  if (method !== "POST") {
    return json(res, 405, { ok: false, error: "method_not_allowed" });
  }

  if (!sharedSecretOk(req)) {
    return json(res, 401, { ok: false, error: "unauthorized" });
  }

  const raw = await readRawBody(req);

  if (url === "/inbound") {
    // Verify Meta's signature over the exact raw body before trusting anything.
    if (!verifySignature(raw, req.headers["x-hub-signature-256"] as string | undefined)) {
      return json(res, 401, { ok: false, error: "bad_signature" });
    }
    // Acknowledge fast; process the messages after responding.
    json(res, 200, { ok: true });
    try {
      const messages = parseInbound(JSON.parse(raw));
      for (const msg of messages) {
        await handleInbound(msg);
      }
    } catch (err) {
      console.error("/inbound processing failed", err);
    }
    return;
  }

  const cronJobs: Record<string, () => Promise<unknown>> = {
    "/cron/reminders": runReminders,
    "/cron/followup": runFollowup,
    "/cron/reactivation": runReactivation,
    "/cron/waitlist": runWaitlist,
  };
  const job = cronJobs[url];
  if (job) {
    try {
      const result = await job();
      return json(res, 200, { ok: true, result });
    } catch (err) {
      console.error(`${url} failed`, err);
      return json(res, 500, { ok: false, error: "cron_failed" });
    }
  }

  return json(res, 404, { ok: false, error: "not_found" });
}

export function start(): void {
  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error("unhandled route error", err);
      if (!res.headersSent) json(res, 500, { ok: false, error: "internal" });
    });
  });
  server.listen(PORT, () => console.log(`Core listening on :${PORT}`));
}

// Start when run directly (tsx core/server.ts / node dist/core/server.js).
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
