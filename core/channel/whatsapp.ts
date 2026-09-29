/**
 * WhatsApp Cloud API channel adapter (Meta, direct; no BSP).
 * Same code for every vertical. See BUILD.md section 4.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface InboundMessage {
  /** The customer's WhatsApp phone (E.164). */
  from: string;
  /** The business phone number id the message arrived on. Routes to a business. */
  phoneNumberId: string;
  /** The text body. Media handling comes later. */
  text: string;
  /** Provider message id, for idempotency. */
  messageId: string;
}

/** Verify the webhook subscription handshake (GET). */
export function verifyWebhook(query: {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}): string | null {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (query["hub.mode"] === "subscribe" && query["hub.verify_token"] === expected) {
    return query["hub.challenge"] ?? "";
  }
  return null;
}

/**
 * Verify Meta's X-Hub-Signature-256 over the exact raw request body.
 * Uses the app secret (not the access token). Returns false on any mismatch.
 */
export function verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) throw new Error("WHATSAPP_APP_SECRET must be set");
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Parse a Meta webhook payload into InboundMessages (text only for now). */
export function parseInbound(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as Array<{ changes?: unknown[] }>) {
    for (const change of entry.changes ?? []) {
      const value = (change as { value?: any }).value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      for (const msg of value?.messages ?? []) {
        if (msg.type === "text" && phoneNumberId) {
          out.push({
            from: msg.from,
            phoneNumberId,
            text: msg.text?.body ?? "",
            messageId: msg.id,
          });
        }
      }
    }
  }
  return out;
}

/** Send a text reply. Wrapped and logged; caller has a clean failure path. */
export async function sendText(
  phoneNumberId: string,
  to: string,
  body: string,
): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("WHATSAPP_TOKEN must be set");

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("whatsapp sendText failed", res.status, detail);
    throw new Error(`WhatsApp send failed: ${res.status}`);
  }
}
