export interface Customer {
  id: string;
  waPhone: string;
  name?: string;
  reactivatedAt?: string;
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
  resource?: string;
  party?: number;
  startsAt?: string;
  durationMin?: number;
  status: "confirmed" | "cancelled" | "completed" | "no_show" | "waitlist";
  reference?: string;
  backendEventId?: string;
  reminderSentAt?: string;
  followupSentAt?: string;
  waitlistNotifiedAt?: string;
}

// A booking due a message (reminder or follow-up), joined with the customer's
// contact details so the scheduled job can send without a second lookup.
export interface DueMessage {
  engagementId: string;
  businessId: string;
  customerPhone: string;
  customerName?: string;
  service?: string;
  startsAt: string;
  durationMin?: number;
}

// Backwards-compatible alias; reminders and follow-ups share the shape.
export type DueReminder = DueMessage;

// A customer who has gone quiet and is due a reactivation nudge.
export interface DueReactivation {
  businessId: string;
  customerId: string;
  customerPhone: string;
  customerName?: string;
}

// A waitlist entry to check against freed capacity.
export interface DueWaitlist {
  engagementId: string;
  businessId: string;
  customerPhone: string;
  customerName?: string;
  service?: string;
  date: string; // YYYY-MM-DD the customer is waiting for
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

  // Booking lifecycle (reschedule, cancel, waitlist).
  findEngagementByReference(businessId: string, reference: string): Promise<Engagement | null>;
  updateEngagement(id: string, patch: Partial<Engagement>): Promise<void>;

  // Follow-up (daily): past confirmed/completed engagements with no follow-up sent.
  dueFollowups(nowISO: string): Promise<DueMessage[]>;
  markFollowupSent(engagementId: string, atISO: string): Promise<void>;

  // Reactivation (weekly): customers whose last engagement is older than dormantDays,
  // with nothing upcoming, not already reactivated inside the window.
  dueReactivations(nowISO: string, dormantDays: number): Promise<DueReactivation[]>;
  markReactivated(customerId: string, atISO: string): Promise<void>;

  // Waitlist: entries not yet notified, for the safety-net scan.
  openWaitlist(nowISO: string): Promise<DueWaitlist[]>;
  markWaitlistNotified(engagementId: string, atISO: string): Promise<void>;

  // Covers resource model: confirmed reservations on a date, to sum against capacity.
  reservationsOn(businessId: string, dateISO: string): Promise<ReservationLoad[]>;

  // Observability: record each scheduled-job run and read the recent ones.
  recordCronRun(job: string, result: CronRunResult, atISO: string): Promise<void>;
  recentCronRuns(limit: number): Promise<CronRun[]>;
}

export interface ReservationLoad {
  startsAt: string;
  party: number;
  durationMin?: number;
}

export interface CronRunResult {
  sent: number;
  skipped: number;
  failed: number;
}

export interface CronRun extends CronRunResult {
  job: string;
  ranAt: string;
}
