export interface Customer {
  id: string;
  waPhone: string;
  name?: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface Engagement {
  id: string;
  businessId: string;
  customerId: string;
  kind: "appointment" | "reservation" | "order" | "lead";
  service?: string;
  startsAt?: string;
  durationMin?: number;
  status: "confirmed" | "cancelled" | "completed" | "no_show" | "waitlist";
  reference?: string;
  backendEventId?: string;
  reminderSentAt?: string;
}

// A booking due a reminder, joined with the customer's contact details so the
// scheduled job can send without a second lookup.
export interface DueReminder {
  engagementId: string;
  businessId: string;
  customerPhone: string;
  customerName?: string;
  service?: string;
  startsAt: string;
  durationMin?: number;
}

// The Core only knows this interface. Dev uses the in-memory store; prod
// uses the Supabase store. Swapping them changes nothing in the brain.
export interface Store {
  getOrCreateCustomer(businessId: string, waPhone: string): Promise<Customer>;
  getOrCreateConversation(businessId: string, customerId: string): Promise<string>;
  getHistory(conversationId: string): Promise<Message[]>;
  appendMessage(conversationId: string, m: Message): Promise<void>;
  createEngagement(e: Omit<Engagement, "id">): Promise<Engagement>;
  // Dedupe inbound webhooks. Returns true the first time a provider message id
  // is seen (safe to process), false if it was already handled.
  claimMessage(businessId: string, providerMessageId: string): Promise<boolean>;
  // Confirmed engagements starting within [now, now + windowHours] that have not
  // had a reminder sent. The window is the idempotency partner of markReminderSent.
  dueReminders(nowISO: string, windowHours: number): Promise<DueReminder[]>;
  markReminderSent(engagementId: string, atISO: string): Promise<void>;
}
