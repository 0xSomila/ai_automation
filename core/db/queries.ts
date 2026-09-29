/**
 * Typed access to the shared state store (Supabase). One schema, all verticals.
 * See BUILD.md section 8.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface Business {
  id: string;
  slug: string;
  vertical: string;
  config: Record<string, unknown>;
}

export interface Customer {
  id: string;
  business_id: string;
  wa_phone: string;
  name: string | null;
}

export interface Conversation {
  id: string;
  business_id: string;
  customer_id: string;
  status: string;
}

export type MessageRole = "user" | "assistant" | "tool";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/** Resolve the business (and its config + vertical) by inbound WhatsApp number. */
export async function findBusinessByChannel(
  channelPhoneId: string,
): Promise<Business | null> {
  const { data, error } = await db()
    .from("businesses")
    .select("id, slug, vertical, config")
    .eq("config->>channelPhoneId", channelPhoneId)
    .maybeSingle();
  if (error) throw error;
  return (data as Business) ?? null;
}

/** Upsert the customer for this business + phone, and return it. */
export async function upsertCustomer(
  businessId: string,
  waPhone: string,
  name?: string,
): Promise<Customer> {
  const { data, error } = await db()
    .from("customers")
    .upsert(
      { business_id: businessId, wa_phone: waPhone, name: name ?? null, last_seen: new Date().toISOString() },
      { onConflict: "business_id,wa_phone" },
    )
    .select("id, business_id, wa_phone, name")
    .single();
  if (error) throw error;
  return data as Customer;
}

/** Get the open conversation for a customer, or start a new one. */
export async function getOrOpenConversation(
  businessId: string,
  customerId: string,
): Promise<Conversation> {
  const existing = await db()
    .from("conversations")
    .select("id, business_id, customer_id, status")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .eq("status", "open")
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as Conversation;

  const { data, error } = await db()
    .from("conversations")
    .insert({ business_id: businessId, customer_id: customerId, status: "open" })
    .select("id, business_id, customer_id, status")
    .single();
  if (error) throw error;
  return data as Conversation;
}

export async function appendMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
): Promise<void> {
  const { error } = await db()
    .from("messages")
    .insert({ conversation_id: conversationId, role, content });
  if (error) throw error;
}

export async function recentMessages(
  conversationId: string,
  limit = 20,
): Promise<{ role: MessageRole; content: string }[]> {
  const { data, error } = await db()
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as { role: MessageRole; content: string }[]).reverse();
}
