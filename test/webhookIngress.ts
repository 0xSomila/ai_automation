import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createWebhookIngress } from "../src/webhookIngress.js";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address !== "string"); return address.port;
}
let calls = 0;
const backend = createServer(async (req, res) => {
  calls++;
  if (req.method === "GET") { assert.equal(req.url, "/webhook?hub.challenge=test-challenge"); res.end("test-challenge"); return; }
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(chunks).toString(), '{ "unchanged": true }');
  assert.equal(req.headers["x-hub-signature-256"], "sha256=test");
  assert.equal(req.headers.authorization, undefined);
  res.writeHead(200).end("EVENT_RECEIVED");
});
const upstreamPort = await listen(backend), ingress = createWebhookIngress(upstreamPort);
const base = `http://127.0.0.1:${await listen(ingress)}`;
try {
  for (const path of ["/", "/dashboard", "/dashboard/", "/dashboard/api/local-session", "/ops/summary", "/cron/reminders", "/healthz", "/webhook/../dashboard", "/webhook%2f..%2fdashboard"]) {
    assert.equal((await fetch(base + path)).status, 404, `${path} must not be forwarded`);
  }
  assert.equal(calls, 0);
  assert.equal((await fetch(`${base}/webhook`, {method:"DELETE"})).status, 405);
  assert.equal(await fetch(`${base}/webhook?hub.challenge=test-challenge`).then(r=>r.text()), "test-challenge");
  assert.equal(await fetch(`${base}/webhook`, {method:"POST",headers:{"Content-Type":"application/json","X-Hub-Signature-256":"sha256=test",Authorization:"must-not-forward"},body:'{ "unchanged": true }'}).then(r=>r.text()), "EVENT_RECEIVED");
  assert.equal(calls, 2);
  console.log("Webhook ingress passed: only exact webhook GET/POST forwarded, raw bytes and signature preserved, dashboard and operational routes blocked.");
} finally { ingress.close(); backend.close(); }
