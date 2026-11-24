import { randomUUID } from "node:crypto";
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
  PractitionerNotice,
} from "./types.js";

// In-memory store for dev and the chat harness.
export class MemoryStore implements Store {
  private customers = new Map<string, Customer>();
  private customersById = new Map<string, Customer>();
  private conversations = new Map<string, string>(); // customerId -> conversationId
  private histories = new Map<string, Message[]>();
  private engagements: Engagement[] = [];
  private seenMessages = new Set<string>();
  private practitionerNotices = new Map<string, PractitionerNotice & { sent?: boolean; expiresAt: string; availableAt: number; lockedUntil: number }>();
  private dailyKeys = new Set<string>();

  constructor(private practitionerRecipients: Record<string, string> = {}) {}

  private queueChange(booking: Engagement, action: string, previousStartsAt?: string): void {
    const recipient = this.practitionerRecipients[booking.businessId];
    if (!recipient || booking.kind !== "appointment" || !booking.startsAt) return;
    const id = randomUUID();
    this.practitionerNotices.set(id, {
      id, businessId: booking.businessId, recipient, kind: "change", leaseToken: "",
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
      availableAt: 0, lockedUntil: 0,
      payload: { action, reference: booking.reference, service: booking.service, bookingName: booking.bookingName, startsAt: booking.startsAt, previousStartsAt, durationMin: booking.durationMin },
    });
  }

  async dailyAppointments(businessId: string, startISO: string, endISO: string): Promise<Engagement[]> {
    return this.engagements.filter((booking) => booking.businessId === businessId && booking.kind === "appointment" &&
      booking.status === "confirmed" && booking.startsAt && Date.parse(booking.startsAt) >= Date.parse(startISO) &&
      Date.parse(booking.startsAt) < Date.parse(endISO)).sort((a, b) => a.startsAt!.localeCompare(b.startsAt!));
  }

  async enqueuePractitionerDaily(businessId: string, recipient: string, date: string, expiresAt: string, parts: Record<string, unknown>[]): Promise<void> {
    if ([...this.practitionerNotices.values()].some((notice) => notice.businessId === businessId && notice.kind === "daily" && notice.payload.date === date)) return;
    for (const [index, payload] of parts.entries()) {
      const key = `${businessId}:${date}:${index}`;
      if (this.dailyKeys.has(key)) continue;
      this.dailyKeys.add(key);
      const id = randomUUID();
      this.practitionerNotices.set(id, { id, businessId, recipient, kind: "daily", payload,
        createdAt: new Date().toISOString(), leaseToken: "", expiresAt, availableAt: 0, lockedUntil: 0 });
    }
  }

  async claimPractitionerNotice(businessId: string): Promise<PractitionerNotice | null> {
    if ([...this.practitionerNotices.values()].some((notice) => notice.businessId === businessId && !notice.sent && notice.lockedUntil > Date.now())) return null;
    const notice = [...this.practitionerNotices.values()].find((entry) => entry.businessId === businessId &&
      !entry.sent && entry.availableAt <= Date.now() && entry.lockedUntil <= Date.now() && Date.parse(entry.expiresAt) > Date.now());
    if (!notice) return null;
    notice.leaseToken = randomUUID();
    notice.lockedUntil = Date.now() + 120_000;
    return { ...notice };
  }

  async finishPractitionerNotice(id: string, leaseToken: string, sent: boolean): Promise<void> {
    const notice = this.practitionerNotices.get(id);
    if (!notice || notice.leaseToken !== leaseToken || notice.sent) throw new Error("Notification claim no longer held");
    notice.sent = sent;
    notice.lockedUntil = 0;
    notice.leaseToken = "";
    notice.availableAt = sent ? 0 : Date.now() + 60_000;
  }

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
    if (full.status === "confirmed") this.queueChange(full, "New booking");
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

  async upcomingBookings(businessId: string, customerId: string, nowISO: string): Promise<Engagement[]> {
    const now = Date.parse(nowISO);
    return this.engagements.filter((booking) =>
      booking.businessId === businessId && booking.customerId === customerId &&
      booking.status === "confirmed" && (booking.kind === "appointment" || booking.kind === "reservation") &&
      booking.startsAt && Date.parse(booking.startsAt) >= now,
    ).sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!));
  }

  async updateEngagement(id: string, patch: Partial<Engagement>): Promise<void> {
    const e = this.engagements.find((x) => x.id === id);
    if (!e) return;
    const previous = { ...e };
    Object.assign(e, patch);
    if (previous.status !== "confirmed") return;
    if (e.status === "cancelled") this.queueChange(e, "Cancelled", previous.startsAt);
    else if (e.status === "confirmed" && e.startsAt !== previous.startsAt) this.queueChange(e, "Rescheduled", previous.startsAt);
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

  private cronRuns: CronRun[] = [];

  async recordCronRun(job: string, result: CronRunResult, atISO: string): Promise<void> {
    this.cronRuns.unshift({ job, ...result, ranAt: atISO });
  }

  async recentCronRuns(limit: number): Promise<CronRun[]> {
    return this.cronRuns.slice(0, limit);
  }
}
