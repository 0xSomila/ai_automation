/**
 * C7 Follow-up (scheduled job). Deployed as n8n id 6GNo7z13BuHHqfgG.
 * Daily 09:00 -> POST {{ $env.CORE_BASE_URL }}/cron/followup. The Core selects past
 * bookings with no follow-up sent, renders the pack follow-up template, sends, and
 * stamps followup_sent_at. n8n is only the clock. See n8n/ARCHITECTURE.md.
 *
 * Deploy config: $env.CORE_BASE_URL + credential "C7 Core Shared Secret"
 * (httpTemplatedCustomAuth, header X-C7-Secret = N8N_WEBHOOK_SECRET).
 */
import { workflow, node, trigger, sticky, newCredential, expr } from "@n8n/workflow-sdk";

const daily = trigger({
  type: "n8n-nodes-base.scheduleTrigger",
  version: 1.4,
  config: {
    name: "Daily 09:00",
    parameters: { rule: { interval: [{ field: "days", daysInterval: 1, triggerAtHour: 9, triggerAtMinute: 0 }] } },
    position: [240, 300],
  },
  output: [{}],
});

const callCore = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Call Core /cron/followup",
    parameters: {
      method: "POST",
      url: expr("{{ $env.CORE_BASE_URL }}/cron/followup"),
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
  "## Follow-up (daily)\nCalls the Core, which selects past bookings with no follow-up sent, renders the pack follow-up template, sends, and stamps followup_sent_at. The Core owns all logic.\nConfig: $env.CORE_BASE_URL and the C7 Core Shared Secret credential (X-C7-Secret).",
  [daily, callCore],
  { color: 5 },
);

export default workflow("c7-followup", "C7 Follow-up").add(daily).to(callCore).add(note);
