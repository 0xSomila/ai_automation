export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface Service {
  name: string;
  durationMin: number;
  priceZar: number;
}

export interface Config {
  slug: string;
  vertical: string;
  practice: {
    name: string;
    location: string;
    address: string;
    parking: string;
    timezone: string;
  };
  hours: Record<DayKey, [string, string] | null>;
  services: Service[];
  policies: {
    medicalAid: string;
    referral: string;
    cancellation: string;
  };
  booking: {
    slotStepMin: number;
    leadTimeHours: number;
    maxDaysAhead: number;
    reminderHoursBefore?: number; // how far ahead a reminder fires; default 24
  };
  voice: {
    language: string;
    currency: string;
    style: string;
  };
  channels: {
    whatsappNumberId: string;
  };
}
