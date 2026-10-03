import { sendTemplate } from "./whatsapp";

// Outbound notifications for the scheduled jobs (reminders, follow-up, etc.).
// Reminders usually fall outside WhatsApp's 24-hour service window, so production
// must send an approved template (name + ordered params), not free text. The
// rendered text is carried for dev/preview and logging.
export interface Notification {
  to: string;
  text: string; // rendered body, for dev channel and logs
  templateName: string; // Meta-approved template name
  params: string[]; // ordered params the approved template expects
  lang?: string;
}

export interface Notifier {
  send(n: Notification): Promise<void>;
}

// Dev/test notifier: records what would be sent and logs it. No external calls.
export class MemoryNotifier implements Notifier {
  public sent: Notification[] = [];
  async send(n: Notification): Promise<void> {
    this.sent.push(n);
    console.log(`[notify:dev] -> ${n.to}: ${n.text}`);
  }
}

// Production notifier: sends the approved WhatsApp template.
// The approved template's parameter order must match `params`.
export class WhatsAppNotifier implements Notifier {
  async send(n: Notification): Promise<void> {
    await sendTemplate(n.to, n.templateName, n.lang ?? "en", n.params);
  }
}
