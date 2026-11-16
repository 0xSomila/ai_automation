import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config/types";
import type { BookingBackend } from "../booking/adapter";
import type { Store } from "../db/types";
import type { Pack } from "./pack";
import { buildSystemPrompt } from "./systemPrompt";
import { executeTool, toolDefs, type ToolCtx } from "./tools";

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";
const MAX_ROUNDS = Number(process.env.MAX_TOOL_ROUNDS || 4);

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

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
  service?: string;
  startsAt?: string;
}

// Match complete, explicit commands. Requests with qualifiers, references or
// a proposed new time still use the conversation and the same booking tools.
const DIRECT_CHANGE = /^(?:actually,?\s+)?(?:please\s+|can you\s+|could you\s+|i (?:need|want|would like) to\s+|i'd like to\s+)?(cancel|postpone|reschedule|move) my (?:appointment|booking)(?:\s+please)?[.!?]*$/i;
const CHANGE_CONFIRMATION = /\b(?:i(?:['’]ve| have)?\s+(?:successfully\s+)?(?:cancelled|canceled|rescheduled|moved|postponed)|(?:appointment|booking)\b[^.!?\n]{0,100}\b(?:has been|is now|was)\s+(?:successfully\s+)?(?:cancelled|canceled|rescheduled|moved|postponed))\b/i;

function bookingLabel(booking: BookingSummary, timeZone: string): string {
  const service = booking.service ?? "appointment";
  if (!booking.startsAt) return service;
  const start = new Intl.DateTimeFormat("en-ZA", {
    timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(booking.startsAt));
  return service + " on " + start;
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
    const reference = result.reference ? " Your reference is " + result.reference + "." : "";
    return "I've cancelled your " + bookingLabel(result, timeZone) + "." + reference;
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

  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: buildSystemPrompt(inp.config, inp.pack),
      cache_control: { type: "ephemeral" },
    },
  ];
  const tools = toolDefs(inp.pack.tools);

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
  let changeConfirmed = false;
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    rounds = round + 1;
    const resp = await client.messages.create({
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
      finalText = text;
      if (!changeConfirmed && CHANGE_CONFIRMATION.test(text)) {
        finalText = "I couldn't confirm that change. Please tell me which booking you'd like to change.";
      }
      break;
    }

    messages.push({ role: "assistant", content: resp.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      inp.hooks?.onToolUse?.(tu.name, tu.input);
      const out = await executeTool(tu.name, tu.input as Record<string, unknown>, ctx);
      if (tu.name === "cancel_appointment" || tu.name === "reschedule_appointment") {
        const { status } = JSON.parse(out);
        changeConfirmed ||= status === "cancelled" || status === "confirmed";
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
