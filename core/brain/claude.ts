/**
 * Claude client and the tool-loop.
 *
 * Prompt caching sits on the fixed Core instructions + pack fragment. The loop
 * runs the model, executes any tools it calls, feeds results back, and returns
 * the final assistant text.
 *
 * See BUILD.md sections 4 and 11.
 */
import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./systemPrompt.js";
import {
  EXECUTORS,
  toolsForPack,
  type ToolContext,
  type ToolName,
} from "./tools.js";
import type { VerticalPack } from "../pack.js";
import type { ClientConfig } from "../config/loader.js";

let anthropic: Anthropic | null = null;

function client(): Anthropic {
  if (anthropic) return anthropic;
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("CLAUDE_API_KEY must be set");
  anthropic = new Anthropic({ apiKey });
  return anthropic;
}

const MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-4-5";
const MAX_TOOL_ITERATIONS = 6;

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** Run one customer turn through the brain, return the reply text. */
export async function runTurn(
  history: Turn[],
  pack: VerticalPack,
  config: ClientConfig,
  toolCtx: ToolContext,
): Promise<string> {
  const { cacheable, dynamic } = buildSystemPrompt(pack, config);
  const tools = toolsForPack(pack.manifest.tools) as Anthropic.Tool[];

  // Prompt caching on the fixed core + pack fragment. Cast covers SDK typings
  // that lag the cache_control API field.
  const system = [
    { type: "text", text: cacheable, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamic },
  ] as Anthropic.MessageCreateParams["system"];

  const messages: Anthropic.MessageParam[] = history.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools,
      messages,
    });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
    }

    messages.push({ role: "assistant", content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const executor = EXECUTORS[use.name as ToolName];
      try {
        const out = await executor(use.input as Record<string, unknown>, toolCtx);
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(out.data ?? { ok: out.ok }),
          is_error: !out.ok,
        });
      } catch (err) {
        // Log the real error; hand the model a clean, non-technical result.
        console.error(`tool ${use.name} failed`, err);
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify({ ok: false, error: "tool_failed" }),
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: results });
  }

  return "Sorry, I could not complete that just now. I will pass this to the team to help you.";
}
