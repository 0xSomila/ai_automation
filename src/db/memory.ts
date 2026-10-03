import { randomUUID } from "node:crypto";
import type { Customer, DueReminder, Engagement, Message, Store } from "./types";

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
}
