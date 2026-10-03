/**
 * C7 Reminders (scheduled job).
 *
 * Source of truth for the n8n workflow. Built and validated with the n8n Workflow SDK,
 * deployed as n8n id otPtBLVUlBLj59Zs. Edit here, re-validate, then update in n8n.
 *
 * Hourly schedule -> POST {{ $env.CORE_BASE_URL }}/cron/reminders. The Core selects due
 * bookings, renders the pack reminder template, sends, and stamps reminder_sent_at.
 * n8n is only the clock; all logic lives in the Core. See n8n/ARCHITECTURE.md.
 *
 * Deploy config in n8n:
 *  - $env.CORE_BASE_URL  the Core HTTP server base URL
 *  - credential "C7 Core Shared Secret" (httpTemplatedCustomAuth): header X-C7-Secret = N8N_WEBHOOK_SECRET
 */
import { workflow, node, trigger, sticky, newCredential, expr } from "@n8n/workflow-sdk";

const everyHour = trigger({
  type: "n8n-nodes-base.scheduleTrigger",
  version: 1.4,
  config: {
    name: "Every hour",
    parameters: {
      rule: { interval: [{ field: "hours", hoursInterval: 1, triggerAtMinute: 0 }] },
    },
    position: [240, 300],
  },
  output: [{}],
});

const callCore = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Call Core /cron/reminders",
    parameters: {
      method: "POST",
      url: expr("{{ $env.CORE_BASE_URL }}/cron/reminders"),
      authentication: "genericCredentialType",
      genericAuthType: "httpTemplatedCustomAuth",
      options: { timeout: 60000 },
    },
    credentials: { httpTemplatedCustomAuth: newCredential("C7 Core Shared Secret") },
    position: [540, 300],
  },
  output: [{ ok: true, result: { sent: 1, skipped: 0, failed: 0 } }],
});

const note = sticky(
  "## Reminders (hourly)\nCalls the Core, which selects due bookings, renders the pack reminder template, sends, and stamps reminder_sent_at. The Core owns all logic; this workflow is only the clock.\nConfig: $env.CORE_BASE_URL and the C7 Core Shared Secret credential (header X-C7-Secret = N8N_WEBHOOK_SECRET).",
  [everyHour, callCore],
  { color: 5 },
);

export default workflow("c7-reminders", "C7 Reminders")
  .add(everyHour)
  .to(callCore)
  .add(note);
