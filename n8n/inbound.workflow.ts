/**
 * C7 WhatsApp Inbound (the spine).
 *
 * Source of truth for the n8n workflow. Built and validated with the n8n Workflow SDK,
 * deployed to n8n as workflow id M8LcXtQ3X8YXzzi1. Edit here, re-validate, then update in n8n.
 *
 * Two webhook triggers on path `whatsapp/inbound`:
 *  - GET: Meta's verify handshake. Echoes hub.challenge only when hub.verify_token
 *    matches $env.WHATSAPP_VERIFY_TOKEN.
 *  - POST: inbound messages. Acknowledges 200 fast, then forwards the RAW body and
 *    X-Hub-Signature-256 to the Core /inbound endpoint, which verifies the HMAC and
 *    runs the brain. n8n stays pure transport; all logic lives in the Core.
 *
 * Deploy config (see n8n/ARCHITECTURE.md):
 *  - $env.CORE_BASE_URL       the Core HTTP server base URL
 *  - $env.WHATSAPP_VERIFY_TOKEN
 *  - credential "C7 Core Shared Secret" (httpTemplatedCustomAuth): header X-C7-Secret = N8N_WEBHOOK_SECRET
 *  - confirm the raw body reference matches the deployed n8n version's rawBody behaviour
 */
import { workflow, node, trigger, sticky, newCredential, expr } from "@n8n/workflow-sdk";

const verifyTrigger = trigger({
  type: "n8n-nodes-base.webhook",
  version: 2.1,
  config: {
    name: "WhatsApp Verify (GET)",
    parameters: {
      httpMethod: "GET",
      path: "whatsapp/inbound",
      responseMode: "responseNode",
      options: {
        onlyRunIf: expr("{{ $json.query['hub.mode'] === 'subscribe' && $json.query['hub.verify_token'] === $env.WHATSAPP_VERIFY_TOKEN }}"),
      },
    },
    position: [240, 200],
  },
  output: [{ query: { "hub.mode": "subscribe", "hub.challenge": "1158201444", "hub.verify_token": "from-env" } }],
});

const respondChallenge = node({
  type: "n8n-nodes-base.respondToWebhook",
  version: 1.5,
  config: {
    name: "Echo Challenge",
    parameters: {
      respondWith: "text",
      responseBody: expr("{{ $json.query['hub.challenge'] }}"),
      options: { responseCode: 200 },
    },
    position: [540, 200],
  },
  output: [{}],
});

const messagesTrigger = trigger({
  type: "n8n-nodes-base.webhook",
  version: 2.1,
  config: {
    name: "WhatsApp Messages (POST)",
    parameters: {
      httpMethod: "POST",
      path: "whatsapp/inbound",
      responseMode: "responseNode",
      options: { rawBody: true },
    },
    position: [240, 480],
  },
  output: [{ headers: { "x-hub-signature-256": "sha256=abc123" }, body: '{"object":"whatsapp_business_account","entry":[]}' }],
});

const respondOk = node({
  type: "n8n-nodes-base.respondToWebhook",
  version: 1.5,
  config: {
    name: "Ack 200",
    parameters: {
      respondWith: "text",
      responseBody: "EVENT_RECEIVED",
      options: { responseCode: 200 },
    },
    position: [540, 480],
  },
  output: [{}],
});

const forwardToCore = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Forward to Core /inbound",
    parameters: {
      method: "POST",
      url: expr("{{ $env.CORE_BASE_URL }}/inbound"),
      authentication: "genericCredentialType",
      genericAuthType: "httpTemplatedCustomAuth",
      sendHeaders: true,
      specifyHeaders: "keypair",
      headerParameters: {
        parameters: [
          { name: "Content-Type", value: "application/json" },
          { name: "X-Hub-Signature-256", value: expr("{{ $('WhatsApp Messages (POST)').item.json.headers['x-hub-signature-256'] }}") },
        ],
      },
      sendBody: true,
      contentType: "raw",
      rawContentType: "application/json",
      body: expr("{{ $('WhatsApp Messages (POST)').item.json.body }}"),
      options: { timeout: 15000 },
    },
    credentials: { httpTemplatedCustomAuth: newCredential("C7 Core Shared Secret") },
    position: [840, 480],
  },
  output: [{ ok: true }],
});

const verifyNote = sticky(
  "## Meta verify handshake\nMeta calls GET once when you subscribe the webhook. This branch echoes hub.challenge only when hub.verify_token matches $env.WHATSAPP_VERIFY_TOKEN.",
  [verifyTrigger, respondChallenge],
  { color: 4 },
);

const messagesNote = sticky(
  "## Inbound messages\nAck 200 fast, then forward the RAW body and X-Hub-Signature-256 to the Core, which verifies the HMAC and runs the brain.\nDeploy: set $env.CORE_BASE_URL, configure the C7 Core Shared Secret credential template with header X-C7-Secret, and confirm the raw body reference matches this n8n version.",
  [messagesTrigger, forwardToCore],
  { color: 3 },
);

export default workflow("c7-whatsapp-inbound", "C7 WhatsApp Inbound")
  .add(verifyTrigger)
  .to(respondChallenge)
  .add(messagesTrigger)
  .to(respondOk)
  .to(forwardToCore)
  .add(verifyNote)
  .add(messagesNote)
  .group("Message handling", [respondOk, forwardToCore], {
    description: "Acknowledge the webhook, then forward the raw payload to the Core for verification and processing.",
  });
