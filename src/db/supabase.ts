import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Customer, Engagement, Message, Store } from "./types";

// Production store. Apply src/db/schema.sql to the project first.
export class SupabaseStore implements Store {
  private db: SupabaseClient;

  constructor() {
    this.db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  }

  async getOrCreateCustomer(businessId: string, waPhone: string): Promise<Customer> {
    const { data: existing } = await this.db
      .from("customers")
      .select("id, wa_phone, name")
      .eq("business_id", businessId)
      .eq("wa_phone", waPhone)
      .maybeSingle();
    if (existing) return { id: existing.id, waPhone: existing.wa_phone, name: existing.name };

    const { data, error } = await this.db
      .from("customers")
      .insert({ business_id: businessId, wa_phone: waPhone })
      .select("id, wa_phone, name")
      .single();
    if (error) throw error;
    return { id: data.id, waPhone: data.wa_phone, name: data.name };
  }

  async getOrCreateConversation(businessId: string, customerId: string): Promise<string> {
    const { data: open } = await this.db
      .from("conversations")
      .select("id")
      .eq("business_id", businessId)
      .eq("customer_id", customerId)
      .eq("status", "open")
      .maybeSingle();
    if (open) return open.id;

    const { data, error } = await this.db
      .from("conversations")
      .insert({ business_id: businessId, customer_id: customerId })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async getHistory(conversationId: string): Promise<Message[]> {
    const { data, error } = await this.db
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  }

  async appendMessage(conversationId: string, m: Message): Promise<void> {
    const { error } = await this.db
      .from("messages")
      .insert({ conversation_id: conversationId, role: m.role, content: m.content });
    if (error) throw error;
  }

  async createEngagement(e: Omit<Engagement, "id">): Promise<Engagement> {
    const { data, error } = await this.db
      .from("engagements")
      .insert({
        business_id: e.businessId,
        customer_id: e.customerId,
        kind: e.kind,
        service: e.service,
        starts_at: e.startsAt,
        duration_min: e.durationMin,
        status: e.status,
        reference: e.reference,
        backend_event_id: e.backendEventId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ...e, id: data.id };
  }

  async claimMessage(businessId: string, providerMessageId: string): Promise<boolean> {
    const { error } = await this.db
      .from("processed_messages")
      .insert({ provider_message_id: providerMessageId, business_id: businessId });
    if (!error) return true;
    // 23505 = unique_violation: already processed.
    if ((error as { code?: string }).code === "23505") return false;
    throw error;
  }
}
