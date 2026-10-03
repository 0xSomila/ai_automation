/**
 * C7 Reactivation (scheduled job). Deployed as n8n id x5GJVKS16xbAhNE3.
 * Weekly Mon 09:00 -> POST {{ $env.CORE_BASE_URL }}/cron/reactivation. The Core finds
 * customers dormant beyond 30 days with nothing upcoming, renders the pack reactivation
 * template, sends, and stamps the customer. n8n is only the clock. See n8n/ARCHITECTURE.md.
 *
 * Deploy config: $env.CORE_BASE_URL + credential "C7 Core Shared Secret"
 * (httpTemplatedCustomAuth, header X-C7-Secret = N8N_WEBHOOK_SECRET).
 */
import { workflow, node, trigger, sticky, newCredential, expr } from "@n8n/workflow-sdk";

const weekly = trigger({
  type: "n8n-nodes-base.scheduleTrigger",
  version: 1.4,
  config: {
    name: "Weekly Mon 09:00",
    parameters: {
      rule: { interval: [{ field: "weeks", weeksInterval: 1, triggerAtDay: [1], triggerAtHour: 9, triggerAtMinute: 0 }] },
    },
    position: [240, 300],
  },
  output: [{}],
});

const callCore = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Call Core /cron/reactivation",
    parameters: {
      method: "POST",
      url: expr("{{ $env.CORE_BASE_URL }}/cron/reactivation"),
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
  "## Reactivation (weekly)\nCalls the Core, which finds customers dormant beyond 30 days with nothing upcoming, renders the pack reactivation template, sends, and stamps the customer. The Core owns all logic.\nConfig: $env.CORE_BASE_URL and the C7 Core Shared Secret credential (X-C7-Secret).",
  [weekly, callCore],
  { color: 5 },
);

export default workflow("c7-reactivation", "C7 Reactivation").add(weekly).to(callCore).add(note);
