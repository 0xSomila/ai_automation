import { randomUUID } from "node:crypto";
import type {
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

// In-memory store for dev and the chat harness.
export class MemoryStore implements Store {
  private customers = new Map<string, Customer>();
  private customersById = new Map<string, Customer>();
  private conversations = new Map<string, string>(); // customerId -> conversationId
  private histories = new Map<string, Message[]>();
  private engagements: Engagement[] = [];
  private seenMessages = new Set<string>();

  async getOrCreateCustomer(_businessId: string, waPhone: string): Promise<Customer> {
    let c = this.customers.get(waPhone);
    if (!c) {
      c = { id: randomUUID(), waPhone };
      this.customers.set(waPhone, c);
      this.customersById.set(c.id, c);
    }
    return c;
  }

  async getOrCreateConversation(_businessId: string, customerId: string): Promise<string> {
    let id = this.conversations.get(customerId);
    if (!id) {
      id = randomUUID();
      this.conversations.set(customerId, id);
      this.histories.set(id, []);
    }
    return id;
  }

  async getHistory(conversationId: string): Promise<Message[]> {
    return this.histories.get(conversationId) ?? [];
  }

  async appendMessage(conversationId: string, m: Message): Promise<void> {
    const h = this.histories.get(conversationId) ?? [];
    h.push(m);
    this.histories.set(conversationId, h);
  }

  async createEngagement(e: Omit<Engagement, "id">): Promise<Engagement> {
    const full = { ...e, id: randomUUID() };
    this.engagements.push(full);
    return full;
  }

  async claimMessage(_businessId: string, providerMessageId: string): Promise<boolean> {
    if (this.seenMessages.has(providerMessageId)) return false;
    this.seenMessages.add(providerMessageId);
    return true;
  }

  async dueReminders(nowISO: string, windowHours: number): Promise<DueReminder[]> {
    const now = Date.parse(nowISO);
    const until = now + windowHours * 36e5;
    const out: DueReminder[] = [];
    for (const e of this.engagements) {
      if (e.status !== "confirmed" || e.reminderSentAt || !e.startsAt) continue;
      const t = Date.parse(e.startsAt);
      if (t < now || t > until) continue;
      const customer = this.customersById.get(e.customerId);
      if (!customer) continue;
      out.push({
        engagementId: e.id,
        businessId: e.businessId,
        customerPhone: customer.waPhone,
        customerName: customer.name,
        service: e.service,
        startsAt: e.startsAt,
        durationMin: e.durationMin,
      });
    }
    return out;
  }

  async markReminderSent(engagementId: string, atISO: string): Promise<void> {
    const e = this.engagements.find((x) => x.id === engagementId);
    if (e) e.reminderSentAt = atISO;
  }

  async findEngagementByReference(
    businessId: string,
    reference: string,
  ): Promise<Engagement | null> {
    return (
      this.engagements.find((e) => e.businessId === businessId && e.reference === reference) ?? null
    );
  }

  async updateEngagement(id: string, patch: Partial<Engagement>): Promise<void> {
    const e = this.engagements.find((x) => x.id === id);
    if (e) Object.assign(e, patch);
  }

  private toDueMessage(e: Engagement): DueMessage | null {
    if (!e.startsAt) return null;
    const customer = this.customersById.get(e.customerId);
    if (!customer) return null;
    return {
      engagementId: e.id,
      businessId: e.businessId,
      customerPhone: customer.waPhone,
      customerName: customer.name,
      service: e.service,
      startsAt: e.startsAt,
      durationMin: e.durationMin,
    };
  }

  async dueFollowups(nowISO: string): Promise<DueMessage[]> {
    const now = Date.parse(nowISO);
    const out: DueMessage[] = [];
    for (const e of this.engagements) {
      if (e.followupSentAt || !e.startsAt) continue;
      if (e.status !== "confirmed" && e.status !== "completed") continue;
      if (Date.parse(e.startsAt) >= now) continue; // only past engagements
      const d = this.toDueMessage(e);
      if (d) out.push(d);
    }
    return out;
  }

  async markFollowupSent(engagementId: string, atISO: string): Promise<void> {
    const e = this.engagements.find((x) => x.id === engagementId);
    if (e) e.followupSentAt = atISO;
  }

  async dueReactivations(nowISO: string, dormantDays: number): Promise<DueReactivation[]> {
    const now = Date.parse(nowISO);
    const cutoff = now - dormantDays * 864e5;
    const out: DueReactivation[] = [];
    for (const customer of this.customersById.values()) {
      const theirs = this.engagements.filter(
        (e) => e.customerId === customer.id && e.startsAt && e.status !== "cancelled",
      );
      if (theirs.length === 0) continue;
      const times = theirs.map((e) => Date.parse(e.startsAt!));
      const last = Math.max(...times);
      const hasFuture = times.some((t) => t > now);
      if (hasFuture || last >= cutoff) continue;
      if (customer.reactivatedAt && Date.parse(customer.reactivatedAt) >= cutoff) continue;
      out.push({
        businessId: theirs[0].businessId,
        customerId: customer.id,
        customerPhone: customer.waPhone,
        customerName: customer.name,
      });
    }
    return out;
  }

  async markReactivated(customerId: string, atISO: string): Promise<void> {
    const c = this.customersById.get(customerId);
    if (c) c.reactivatedAt = atISO;
  }

  async openWaitlist(nowISO: string): Promise<DueWaitlist[]> {
    const now = Date.parse(nowISO);
    const out: DueWaitlist[] = [];
    for (const e of this.engagements) {
      if (e.status !== "waitlist" || e.waitlistNotifiedAt || !e.startsAt) continue;
      if (Date.parse(e.startsAt) < now) continue; // past preference, skip
      const customer = this.customersById.get(e.customerId);
      if (!customer) continue;
      out.push({
        engagementId: e.id,
        businessId: e.businessId,
        customerPhone: customer.waPhone,
        customerName: customer.name,
        service: e.service,
        date: e.startsAt.slice(0, 10),
      });
    }
    return out;
  }

  async markWaitlistNotified(engagementId: string, atISO: string): Promise<void> {
    const e = this.engagements.find((x) => x.id === engagementId);
    if (e) e.waitlistNotifiedAt = atISO;
  }

  async reservationsOn(businessId: string, dateISO: string): Promise<ReservationLoad[]> {
    return this.engagements
      .filter(
        (e) =>
          e.businessId === businessId &&
          e.kind === "reservation" &&
          e.status === "confirmed" &&
          e.startsAt?.startsWith(dateISO),
      )
      .map((e) => ({ startsAt: e.startsAt!, party: e.party ?? 1, durationMin: e.durationMin }));
  }
}
