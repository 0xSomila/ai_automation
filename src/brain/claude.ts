import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config/types.js";
import type { BookingBackend } from "../booking/adapter.js";
import { practiceTime } from "../booking/time.js";
import type { Message, Store } from "../db/types.js";
import type { Pack } from "./pack.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { executeTool, toolDefs, type ToolCtx } from "./tools.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";
const MAX_ROUNDS = Number(process.env.MAX_TOOL_ROUNDS || 4);

let client: Anthropic | undefined;
function modelClient(): Anthropic {
  return client ??= new Anthropic(); // only booking conversations need the API key
}

// Optional observation hooks. Production passes none; the test runner passes
// onToolUse to assert which tools fired on a turn.
export interface BrainHooks {
  onToolUse?: (name: string, input: unknown) => void;
}

export interface BrainInput {
  config: Config;
  pack: Pack;
  backend: BookingBackend;
  store: Store;
  businessId: string;
  customerId: string;
  conversationId: string;
  userText: string;
  hooks?: BrainHooks;
}

interface BookingSummary {
  reference?: string;
  service?: string;
  startsAt?: string;
}

// Match complete, explicit commands. Requests with qualifiers, references or
// a proposed new time still use the conversation and the same booking tools.
const DIRECT_CHANGE = /^(?:actually,?\s+)?(?:please\s+|can you\s+|could you\s+|i (?:need|want|would like) to\s+|i'd like to\s+)?(cancel|postpone|reschedule|move) (?:my|the) (?:appointment|booking)(?:\s+please)?[.!?]*$/i;
const CHANGE_CONFIRMATION = /\b(?:i(?:['’]ve| have)?\s+(?:successfully\s+)?(?:cancelled|canceled|rescheduled|moved|postponed)|(?:appointment|booking)\b[^.!?\n]{0,100}\b(?:has been|is now|was)\s+(?:successfully\s+)?(?:cancelled|canceled|rescheduled|moved|postponed))\b/i;

const BOOKING_CONFIRMATION = /\b(?:you(?:['’]re| are)\s+(?:all\s+)?booked|(?:i(?:['’]ve| have)|we(?:['’]ve| have))\s+booked|(?:appointment|consultation|reservation|booking|table)\b[^.!?\n]{0,80}\b(?:is|was|has been)\s+(?:now\s+)?(?:booked|confirmed)|(?:booking\s+)?reference\s*(?:is\s*)?[:#]?\s*C7-[A-Z0-9]+)\b/i;

interface ConfirmedBooking {
  reference: string;
  date: string;
  time: string;
  service?: string;
  party?: number;
}

function bookingConfirmation(booking: ConfirmedBooking, config: Config, action = "booked"): string {
  const timeZone = config.practice.timezone;
  const start = new Date(practiceTime(booking.date, booking.time, timeZone)).toISOString();
  const service = booking.party ? "table for " + booking.party : booking.service;
  const label = bookingLabel({ service, startsAt: start }, timeZone);
  return "Your " + label + " is " + action + ". Your reference is " + booking.reference + ".";
}

function bookingLabel(booking: BookingSummary, timeZone: string): string {
  const service = booking.service ?? "appointment";
  if (!booking.startsAt) return service;
  const start = new Intl.DateTimeFormat("en-ZA", {
    timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(booking.startsAt));
  return service + " on " + start;
}

const CHANGE_REQUEST = /\b(cancel|postpone|reschedule|move)\b/i;
const CANCEL_COMMAND = /^(?:(?:no|yes|actually),?\s+)?(?:(?:please|can you|could you|i (?:need|want|would like) to|i'd like to)\s+)?cancel\b/i;
const NEW_BOOKING_REQUEST = /\b(?:book|rebook|schedule|make)\s+(?:me\s+)?(?:an?|another|a new|the|my)\s+(?:appointment|consultation|booking|table)\b/i;
const CLOCK = "(?:[01]?\\d|2[0-3]):[0-5]\\d";
const TIME_RANGE = new RegExp("\\bfrom\\s+(" + CLOCK + ")\\s+to\\s+(" + CLOCK + ")\\b", "i");
const EXISTING_TIME = new RegExp("\\b(" + CLOCK + ")\\b");
const DATE_QUALIFIER = /\b(?:today|tomorrow|yesterday|next|last|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th))\b/i;

function changeRequest(history: Message[]) {
  for (const message of [...history].reverse()) {
    if (message.role === "assistant") {
      if (/\bC7-[A-Z0-9]+\b/i.test(message.content) && (BOOKING_CONFIRMATION.test(message.content) || CHANGE_CONFIRMATION.test(message.content))) return;
      continue;
    }
    if (NEW_BOOKING_REQUEST.test(message.content) && !CHANGE_REQUEST.test(message.content)) return;
    const command = message.content.match(CHANGE_REQUEST)?.[1].toLowerCase();
    if (!command) continue;
    if (/\b(?:policy|fee|charge|what if|how do i|can i|could i|if i|don['’]?t|do not|never)\b/i.test(message.content)) return;
    return { command, request: message.content };
  }
}

function localSlot(startsAt: string, timeZone: string) {
  const start = new Date(startsAt);
  return {
    date: new Intl.DateTimeFormat("en-CA", { timeZone }).format(start),
    time: new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(start),
  };
}

async function bookingChange(history: Message[], inp: BrainInput) {
  if (!inp.pack.tools.includes("list_upcoming_bookings")) return;
  const change = changeRequest(history);
  if (!change) return;
  const tool = change.command === "cancel" ? "cancel_appointment" : "reschedule_appointment";
  const range = change.request.match(TIME_RANGE);
  const originalTime = range?.[1] ?? (tool === "cancel_appointment" ? change.request.match(EXISTING_TIME)?.[1] : undefined);
  const reference = change.request.match(/\bC7-[A-Z0-9]+\b/i)?.[0].toUpperCase();
  const bookings = (await inp.store.upcomingBookings(inp.businessId, inp.customerId, new Date().toISOString()))
    .flatMap(({ reference: bookingRef, startsAt, service }) => {
      if (!bookingRef || !startsAt) return [];
      const slot = localSlot(startsAt, inp.config.practice.timezone);
      if (reference && bookingRef !== reference) return [];
      if (originalTime && slot.time !== originalTime.padStart(5, "0")) return [];
      return [{ reference: bookingRef, service, ...slot }];
    });
  return { ...change, tool, bookings, originalTime, sameDayTime: range?.[2]?.padStart(5, "0") };
}

function cancellationConfirmation(booking: BookingSummary, timeZone: string): string {
  const reference = booking.reference ? " Your reference is " + booking.reference + "." : "";
  return "I've cancelled your " + bookingLabel(booking, timeZone) + "." + reference;
}

async function handleDirectChange(inp: BrainInput, ctx: ToolCtx): Promise<string | undefined> {
  if (!inp.pack.tools.includes("list_upcoming_bookings")) return;
  const command = inp.userText.trim().replaceAll("’", "'").match(DIRECT_CHANGE)?.[1].toLowerCase();
  if (!command) return;
  const tool = command === "cancel" ? "cancel_appointment" : "list_upcoming_bookings";
  inp.hooks?.onToolUse?.(tool, {});
  const result = JSON.parse(await executeTool(tool, {}, ctx));
  const timeZone = inp.config.practice.timezone;
  if (result.status === "cancelled") {
    return cancellationConfirmation(result, timeZone);
  }
  const bookings: BookingSummary[] = result.bookings ?? [];
  if (bookings.length === 0) return "I couldn't find a matching upcoming booking in this chat.";
  if (bookings.length === 1) {
    return "What day and time would you like to move your " + bookingLabel(bookings[0], timeZone) + " to?";
  }
  const options = bookings.slice(0, 5).map((booking) => "• " + bookingLabel(booking, timeZone)).join("\n");
  const more = bookings.length > 5 ? "\nYou can also tell me another date to look for." : "";
  return "Which booking would you like to " + command + "?\n" + options + more;
}

// One inbound message to one reply. Persists both sides. Runs the tool
// loop up to MAX_ROUNDS, pinned to MODEL, with the system prompt cached.
export async function runBrain(inp: BrainInput): Promise<string> {
  await inp.store.appendMessage(inp.conversationId, { role: "user", content: inp.userText });
  const ctx: ToolCtx = {
    config: inp.config,
    pack: inp.pack,
    backend: inp.backend,
    store: inp.store,
    businessId: inp.businessId,
    customerId: inp.customerId,
  };
  const directReply = await handleDirectChange(inp, ctx);
  if (directReply) {
    await inp.store.appendMessage(inp.conversationId, { role: "assistant", content: directReply });
    return directReply;
  }

  const history = await inp.store.getHistory(inp.conversationId);
  const change = await bookingChange(history, inp);
  if (change && change.request === inp.userText && change.bookings.length === 1 && !DATE_QUALIFIER.test(change.request)) {
    const [booking] = change.bookings;
    const args = change.tool === "cancel_appointment" && change.originalTime && CANCEL_COMMAND.test(change.request.replaceAll("’", "'"))
      ? { reference: booking.reference }
      : change.sameDayTime ? { reference: booking.reference, date: booking.date, time: change.sameDayTime } : undefined;
    if (args) {
      inp.hooks?.onToolUse?.(change.tool, args);
      const result = JSON.parse(await executeTool(change.tool, args, ctx));
      const reply = result.status === "cancelled" ? cancellationConfirmation(result, inp.config.practice.timezone)
        : result.status === "confirmed" ? bookingConfirmation(result, inp.config, "rescheduled")
        : "I couldn't make that change. Please choose another time or confirm the appointment details.";
      await inp.store.appendMessage(inp.conversationId, { role: "assistant", content: reply });
      return reply;
    }
  }

  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: buildSystemPrompt(inp.config, inp.pack),
      cache_control: { type: "ephemeral" },
    },
  ];
  if (change) {
    system.push({ type: "text", text: "The customer is changing an existing booking. Keep that action across clarification turns. The matching upcoming bookings below come from the database, with dates and times in the practice's time zone. Use only a listed reference and match the customer's original date and time before applying a change. For a time-only answer when moving an identified booking, keep its original date unless the customer asked for another date. When the customer chooses a new time, call reschedule_appointment even if an earlier availability reply omitted it. Matching bookings: " + JSON.stringify(change.bookings) });
  }
  const tools = toolDefs(change ? ["list_upcoming_bookings", "check_availability", change.tool] : inp.pack.tools);

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let finalText = "";
  let inTokens = 0;
  let outTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let rounds = 0;
  let retriedBookingConfirmation = false;
  bookingTurn: for (let round = 0; round <= MAX_ROUNDS; round++) {
    rounds = round + 1;
    const resp = await modelClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
      tools,
    });

    inTokens += resp.usage.input_tokens;
    outTokens += resp.usage.output_tokens;
    cacheRead += resp.usage.cache_read_input_tokens ?? 0;
    cacheWrite += resp.usage.cache_creation_input_tokens ?? 0;

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (toolUses.length === 0) {
      if (change && (BOOKING_CONFIRMATION.test(text) || CHANGE_CONFIRMATION.test(text))) {
        finalText = "I couldn't confirm that change. Please confirm the original appointment date and time.";
        break;
      }
      if (!change && inp.pack.tools.includes("book_appointment") && BOOKING_CONFIRMATION.test(text)) {
        if (!retriedBookingConfirmation && round < MAX_ROUNDS) {
          retriedBookingConfirmation = true;
          messages.push(
            { role: "assistant", content: text },
            {
              role: "user",
              content: "System correction: the draft above did not create a booking. Continue the original customer request. If the customer selected a time and gave the required details, call book_appointment now. If anything is missing, ask for it. Do not treat this correction or the draft as customer consent or booking evidence.",
            },
          );
          continue;
        }
        finalText = "I couldn't confirm the booking. Please tell me the service, date, time and name you'd like to book under.";
        break;
      }
      finalText = text;
      if (CHANGE_CONFIRMATION.test(text)) {
        finalText = "I couldn't confirm that change. Please tell me which booking you'd like to change.";
      }
      break;
    }

    messages.push({ role: "assistant", content: resp.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const args = tu.input as Record<string, unknown>;
      if (change && tu.name === change.tool) {
        if (!args.reference && change.bookings.length === 1) args.reference = change.bookings[0].reference;
        if (!change.bookings.some((booking) => booking.reference === args.reference)) {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: "No matching booking selected. Ask which appointment to change.", is_error: true });
          continue;
        }
      }
      if (!tools.some((tool) => tool.name === tu.name)) {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: "This action is unavailable for the current request.", is_error: true });
        continue;
      }
      inp.hooks?.onToolUse?.(tu.name, args);
      const out = await executeTool(tu.name, args, ctx);
      if (tu.name === "book_appointment") {
        const result = JSON.parse(out) as ConfirmedBooking & { status: string };
        if (result.status === "confirmed") {
          finalText = bookingConfirmation(result, inp.config);
          break bookingTurn;
        }
      }
      if (tu.name === "cancel_appointment" || tu.name === "reschedule_appointment") {
        const result = JSON.parse(out);
        const { status } = result;
        if (status === "cancelled" || status === "confirmed") {
          finalText = status === "cancelled" ? cancellationConfirmation(result, inp.config.practice.timezone)
            : bookingConfirmation(result, inp.config, "rescheduled");
          break bookingTurn;
        }
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
    }
    messages.push({ role: "user", content: results });
  }

  if (!finalText) finalText = "Sorry, could you say that again?";
  await inp.store.appendMessage(inp.conversationId, { role: "assistant", content: finalText });

  // Log token usage per handled message (CLAUDE.md rule).
  const conv = inp.conversationId.slice(0, 8);
  console.error(
    `[tokens] conv=${conv} rounds=${rounds} in=${inTokens} out=${outTokens} cacheRead=${cacheRead} cacheWrite=${cacheWrite}`,
  );

  return finalText;
}
