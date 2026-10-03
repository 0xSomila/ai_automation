/**
 * C7 Waitlist (scheduled safety net). Deployed as n8n id p318TJhr6QerzWdD.
 * Every 15 min -> POST {{ $env.CORE_BASE_URL }}/cron/waitlist. The Core checks each
 * un-notified waitlist entry against freed capacity on its date and messages the customer
 * if a space opened, stamping waitlist_notified_at. n8n is only the clock. See n8n/ARCHITECTURE.md.
 *
 * Deploy config: $env.CORE_BASE_URL + credential "C7 Core Shared Secret"
 * (httpTemplatedCustomAuth, header X-C7-Secret = N8N_WEBHOOK_SECRET).
 */
import { workflow, node, trigger, sticky, newCredential, expr } from "@n8n/workflow-sdk";

const every15 = trigger({
  type: "n8n-nodes-base.scheduleTrigger",
  version: 1.4,
  config: {
    name: "Every 15 minutes",
    parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 15 }] } },
    position: [240, 300],
  },
  output: [{}],
});

const callCore = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Call Core /cron/waitlist",
    parameters: {
      method: "POST",
      url: expr("{{ $env.CORE_BASE_URL }}/cron/waitlist"),
      authentication: "genericCredentialType",
      genericAuthType: "httpTemplatedCustomAuth",
      options: { timeout: 60000 },
    },
    credentials: { httpTemplatedCustomAuth: newCredential("C7 Core Shared Secret") },
    position: [540, 300],
  },
  output: [{ ok: true, result: { sent: 0, skipped: 0, failed: 0 } }],
});

const note = sticky(
  "## Waitlist safety net (every 15 min)\nCalls the Core, which checks each un-notified waitlist entry against freed capacity on its date and messages the customer if a space opened, stamping waitlist_notified_at. The Core owns all logic.\nConfig: $env.CORE_BASE_URL and the C7 Core Shared Secret credential (X-C7-Secret).",
  [every15, callCore],
  { color: 5 },
);

export default workflow("c7-waitlist", "C7 Waitlist").add(every15).to(callCore).add(note);
