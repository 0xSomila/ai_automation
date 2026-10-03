import { createHmac, timingSafeEqual } from "node:crypto";

const BASE = "https://graph.facebook.com/v21.0";

// Verify Meta's X-Hub-Signature-256 over the EXACT raw request body.
// Uses the app secret, not the access token. Returns false on any mismatch.
export function verifySignature(rawBody: string | Buffer, signatureHeader: string | undefined): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) throw new Error("WHATSAPP_APP_SECRET must be set to verify inbound webhooks");
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function sendText(to: string, body: string): Promise<void> {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!id || !token) throw new Error("WhatsApp env not set");
  const res = await fetch(`${BASE}/${id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
}

export async function sendTemplate(
  to: string,
  name: string,
  lang = "en",
  params: string[] = [],
): Promise<void> {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!id || !token) throw new Error("WhatsApp env not set");
  const components = params.length
    ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
    : [];
  const res = await fetch(`${BASE}/${id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name, language: { code: lang }, components },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp template failed: ${res.status} ${await res.text()}`);
}

export interface InboundMessage {
  from: string;
  text: string;
  messageId: string; // Meta's message id, for dedupe (Meta re-delivers)
  phoneNumberId: string; // the business number it arrived on, for routing
}

// Pull the first text message out of a Cloud API webhook payload.
export function parseInbound(body: any): InboundMessage | null {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg || msg.type !== "text") return null;
  return {
    from: msg.from,
    text: msg.text.body,
    messageId: msg.id,
    phoneNumberId: value?.metadata?.phone_number_id ?? "",
  };
}
