import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  CronRun,
  CronRunResult,
  Customer,
  DueMessage,
  DueReactivation,
  DueReminder,
  DueWaitlist,
  Engagement,
  Message,
  ReservationLoad,
  Store,
} from "./types";

function rowToDueMessage(r: any): DueMessage {
  return {
    engagementId: r.id,
    businessId: r.business_id,
    customerPhone: r.customers?.wa_phone as string,
    customerName: r.customers?.name as string | undefined,
    service: r.service as string | undefined,
    startsAt: r.starts_at as string,
    durationMin: r.duration_min as number | undefined,
  };
}

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
        resource: e.resource,
        party: e.party,
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

  async dueReminders(nowISO: string, windowHours: number): Promise<DueReminder[]> {
    const until = new Date(Date.parse(nowISO) + windowHours * 36e5).toISOString();
    const { data, error } = await this.db
      .from("engagements")
      .select("id, business_id, service, starts_at, duration_min, customers(wa_phone, name)")
      .eq("status", "confirmed")
      .is("reminder_sent_at", null)
      .gte("starts_at", nowISO)
      .lte("starts_at", until);
    if (error) throw error;
    return (data ?? [])
      .map((r: any) => ({
        engagementId: r.id,
        businessId: r.business_id,
        customerPhone: r.customers?.wa_phone as string,
        customerName: r.customers?.name as string | undefined,
        service: r.service as string | undefined,
        startsAt: r.starts_at as string,
        durationMin: r.duration_min as number | undefined,
      }))
      .filter((d) => d.customerPhone);
  }

  async markReminderSent(engagementId: string, atISO: string): Promise<void> {
    const { error } = await this.db
      .from("engagements")
      .update({ reminder_sent_at: atISO })
      .eq("id", engagementId);
    if (error) throw error;
  }

  async findEngagementByReference(
    businessId: string,
    reference: string,
  ): Promise<Engagement | null> {
    const { data, error } = await this.db
      .from("engagements")
      .select(
        "id, business_id, customer_id, kind, service, starts_at, duration_min, status, reference, backend_event_id",
      )
      .eq("business_id", businessId)
      .eq("reference", reference)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      businessId: data.business_id,
      customerId: data.customer_id,
      kind: data.kind,
      service: data.service ?? undefined,
      startsAt: data.starts_at ?? undefined,
      durationMin: data.duration_min ?? undefined,
      status: data.status,
      reference: data.reference ?? undefined,
      backendEventId: data.backend_event_id ?? undefined,
    };
  }

  async updateEngagement(id: string, patch: Partial<Engagement>): Promise<void> {
    const row: Record<string, unknown> = {};
    if ("status" in patch) row.status = patch.status;
    if ("service" in patch) row.service = patch.service;
    if ("startsAt" in patch) row.starts_at = patch.startsAt;
    if ("durationMin" in patch) row.duration_min = patch.durationMin;
    if ("backendEventId" in patch) row.backend_event_id = patch.backendEventId;
    if ("reminderSentAt" in patch) row.reminder_sent_at = patch.reminderSentAt ?? null;
    if ("followupSentAt" in patch) row.followup_sent_at = patch.followupSentAt ?? null;
    if ("waitlistNotifiedAt" in patch) row.waitlist_notified_at = patch.waitlistNotifiedAt ?? null;
    if (Object.keys(row).length === 0) return;
    const { error } = await this.db.from("engagements").update(row).eq("id", id);
    if (error) throw error;
  }

  async dueFollowups(nowISO: string): Promise<DueMessage[]> {
    const { data, error } = await this.db
      .from("engagements")
      .select("id, business_id, service, starts_at, duration_min, customers(wa_phone, name)")
      .in("status", ["confirmed", "completed"])
      .is("followup_sent_at", null)
      .lt("starts_at", nowISO);
    if (error) throw error;
    return (data ?? []).map(rowToDueMessage).filter((d) => d.customerPhone);
  }

  async markFollowupSent(engagementId: string, atISO: string): Promise<void> {
    const { error } = await this.db
      .from("engagements")
      .update({ followup_sent_at: atISO })
      .eq("id", engagementId);
    if (error) throw error;
  }

  async dueReactivations(nowISO: string, dormantDays: number): Promise<DueReactivation[]> {
    const cutoff = new Date(Date.parse(nowISO) - dormantDays * 864e5).toISOString();
    // Candidate customers not reactivated inside the window.
    const { data: customers, error: cErr } = await this.db
      .from("customers")
      .select("id, business_id, wa_phone, name, reactivated_at");
    if (cErr) throw cErr;

    const out: DueReactivation[] = [];
    for (const c of customers ?? []) {
      if (c.reactivated_at && c.reactivated_at >= cutoff) continue;
      const { data: eng, error: eErr } = await this.db
        .from("engagements")
        .select("starts_at, status")
        .eq("customer_id", c.id)
        .neq("status", "cancelled")
        .not("starts_at", "is", null)
        .order("starts_at", { ascending: false })
        .limit(1);
      if (eErr) throw eErr;
      const last = eng?.[0]?.starts_at as string | undefined;
      if (!last || last >= cutoff || last > nowISO) continue; // none, recent, or upcoming
      out.push({
        businessId: c.business_id,
        customerId: c.id,
        customerPhone: c.wa_phone,
        customerName: c.name ?? undefined,
      });
    }
    return out;
  }

  async markReactivated(customerId: string, atISO: string): Promise<void> {
    const { error } = await this.db
      .from("customers")
      .update({ reactivated_at: atISO })
      .eq("id", customerId);
    if (error) throw error;
  }

  async openWaitlist(nowISO: string): Promise<DueWaitlist[]> {
    const { data, error } = await this.db
      .from("engagements")
      .select("id, business_id, service, starts_at, customers(wa_phone, name)")
      .eq("status", "waitlist")
      .is("waitlist_notified_at", null)
      .gte("starts_at", nowISO);
    if (error) throw error;
    return (data ?? [])
      .map((r: any) => ({
        engagementId: r.id,
        businessId: r.business_id,
        customerPhone: r.customers?.wa_phone as string,
        customerName: r.customers?.name as string | undefined,
        service: r.service as string | undefined,
        date: (r.starts_at as string).slice(0, 10),
      }))
      .filter((d) => d.customerPhone);
  }

  async markWaitlistNotified(engagementId: string, atISO: string): Promise<void> {
    const { error } = await this.db
      .from("engagements")
      .update({ waitlist_notified_at: atISO })
      .eq("id", engagementId);
    if (error) throw error;
  }

  async reservationsOn(businessId: string, dateISO: string): Promise<ReservationLoad[]> {
    const dayEnd = new Date(Date.parse(`${dateISO}T00:00:00`) + 864e5).toISOString();
    const { data, error } = await this.db
      .from("engagements")
      .select("starts_at, party, duration_min")
      .eq("business_id", businessId)
      .eq("kind", "reservation")
      .eq("status", "confirmed")
      .gte("starts_at", `${dateISO}T00:00:00`)
      .lt("starts_at", dayEnd);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      startsAt: r.starts_at,
      party: r.party ?? 1,
      durationMin: r.duration_min ?? undefined,
    }));
  }

  async recordCronRun(job: string, result: CronRunResult, atISO: string): Promise<void> {
    const { error } = await this.db
      .from("cron_runs")
      .insert({ job, sent: result.sent, skipped: result.skipped, failed: result.failed, ran_at: atISO });
    if (error) throw error;
  }

  async recentCronRuns(limit: number): Promise<CronRun[]> {
    const { data, error } = await this.db
      .from("cron_runs")
      .select("job, sent, skipped, failed, ran_at")
      .order("ran_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      job: r.job,
      sent: r.sent ?? 0,
      skipped: r.skipped ?? 0,
      failed: r.failed ?? 0,
      ranAt: r.ran_at,
    }));
  }
}
