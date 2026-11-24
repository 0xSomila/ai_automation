/** Runs the practitioner's daily digest and retries queued appointment alerts every minute. */
import { workflow, node, trigger, newCredential, expr } from "@n8n/workflow-sdk";

const schedule = trigger({
  type: "n8n-nodes-base.scheduleTrigger",
  version: 1.4,
  config: {
    name: "Every minute",
    parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } },
    position: [240, 300],
  },
  output: [{}],
});

const callCore = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Call Core /cron/practitioner",
    parameters: {
      method: "POST",
      url: expr("{{ $env.CORE_BASE_URL }}/cron/practitioner"),
      authentication: "genericCredentialType",
      genericAuthType: "httpTemplatedCustomAuth",
      options: { timeout: 60000 },
    },
    credentials: { httpTemplatedCustomAuth: newCredential("C7 Core Shared Secret") },
    position: [540, 300],
  },
  output: [{ ok: true, result: { sent: 0, skipped: 0, failed: 0 } }],
});

export default workflow("c7-practitioner", "C7 Practitioner Updates").add(schedule).to(callCore);
