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

export interface BrainInput {
  config: Config;
  pack: Pack;
  backend: BookingBackend;
  store: Store;
  businessId: string;
  customerId: string;
  conversationId: string;
  userText: string;
}

// One inbound message to one reply. Persists both sides. Runs the tool
// loop up to MAX_ROUNDS, pinned to MODEL, with the system prompt cached.
export async function runBrain(inp: BrainInput): Promise<string> {
  await inp.store.appendMessage(inp.conversationId, { role: "user", content: inp.userText });
  const history = await inp.store.getHistory(inp.conversationId);

  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: buildSystemPrompt(inp.config, inp.pack),
      cache_control: { type: "ephemeral" },
    },
  ];
  const tools = toolDefs(inp.pack.tools);
  const ctx: ToolCtx = {
    config: inp.config,
    backend: inp.backend,
    store: inp.store,
    businessId: inp.businessId,
    customerId: inp.customerId,
  };

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let finalText = "";
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
      tools,
    });

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
      break;
    }

    messages.push({ role: "assistant", content: resp.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const out = await executeTool(tu.name, tu.input as Record<string, unknown>, ctx);
      results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
    }
    messages.push({ role: "user", content: results });
  }

  if (!finalText) finalText = "Sorry, could you say that again?";
  await inp.store.appendMessage(inp.conversationId, { role: "assistant", content: finalText });
  return finalText;
}
