import type { Config } from "../config/types.js";
import type { Pack } from "./pack.js";

const DAY_LABEL: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function renderHours(config: Config): string {
  return (Object.keys(DAY_LABEL) as (keyof typeof DAY_LABEL)[])
    .map((k) => {
      const h = config.hours[k as keyof Config["hours"]];
      return `- ${DAY_LABEL[k]}: ${h ? `${h[0]} to ${h[1]}` : "closed"}`;
    })
    .join("\n");
}

function renderServices(config: Config): string {
  return config.services
    .map((s) => `- ${s.name}, ${s.durationMin} min, R${s.priceZar}`)
    .join("\n");
}

// Fourteen days of "Weekday D Month (YYYY-MM-DD)" in the practice time zone. The model must
// read dates from this list. It is unreliable at working out which date a weekday falls on.
export function renderCalendar(timeZone: string, now: Date = new Date(), days = 14): string {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone });
  const label = new Intl.DateTimeFormat("en-ZA", { timeZone, weekday: "long", day: "numeric", month: "long" });
  const lines: string[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(now.getTime() + i * 864e5);
    lines.push(`- ${i === 0 ? "Today, " : i === 1 ? "Tomorrow, " : ""}${label.format(day)} (${iso.format(day)})`);
  }
  return lines.join("\n");
}

export function buildSystemPrompt(config: Config, pack: Pack, now: Date = new Date()): string {
  const tz = config.practice.timezone;
  const today = now;
  const label = new Intl.DateTimeFormat("en-ZA", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(today);
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(today);

  // Fixed Core instructions. Keep stable for prompt caching.
  const core = `You are the front-desk assistant for ${config.practice.name} in ${config.practice.location}.

Voice: ${config.voice.style}. ${config.voice.language}. Prices in ${config.voice.currency}.
Keep replies to one to four short sentences, the way a real front desk texts. Do not use em dashes; use commas, periods or colons.

${pack.promptFragment.trim()}

Services and prices:
${renderServices(config)}

Practice facts:
- Hours:
${renderHours(config)}
- Address: ${config.practice.address}. ${config.practice.parking}.
- Medical aid: ${config.policies.medicalAid}
- Referral: ${config.policies.referral}
- Cancellations: ${config.policies.cancellation}

Today is ${label} (${iso}) in ${tz}.

Calendar (the only source for dates; never work out a date yourself):
${renderCalendar(tz, now)}

How to book:
1. Find out the service, and the day and time that suits them.
2. ALWAYS call check_availability for a date before offering or confirming any times. Never invent availability.
   Dates: turn "Monday", "tomorrow" or "next week" into a date only by reading the calendar above. When the customer names a weekday, pass it as \`weekday\` to check_availability and book_appointment. If the customer states a date that does not match the weekday they named, or disagrees with the calendar, do not go along with it: say what the calendar shows (for example "Monday is 30 November, and 1 December is a Tuesday") and ask which they mean before checking times. Always say the weekday and the date together when you confirm.
3. Once the customer has selected an open time and you have their name and booking details, call book_appointment.
4. A new booking only exists after book_appointment returns confirmed. Call the tool in the current turn before confirming a new booking. Availability, customer acceptance, and earlier assistant messages are not proof that a booking was saved. If you lack required details, ask for them. If booking fails, explain the result and offer the appropriate next step.

If a request is clinical or outside booking and admin, say the practitioner will advise at the visit. Stay on ${config.practice.name} topics.`;

  return core;
}
