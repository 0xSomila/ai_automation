/**
 * System prompt builder.
 *
 * Order matters for caching: fixed Core instructions + vertical fragment first
 * (cacheable), then the client config block (varies per business). See BUILD.md
 * section 11 step 4.
 */
import type { ClientConfig } from "../config/loader.js";
import type { VerticalPack } from "../pack.js";

/** Fixed, vertical-agnostic instructions. Cache this. */
export const CORE_INSTRUCTIONS = `You are the WhatsApp receptionist for a South African business.

Rules:
- Be warm, brief and clear. Write like a helpful person, not a form.
- Never invent availability, prices or policies. Use the tools and the business
  facts you are given. If you do not know, say you will check.
- All times are in the business timezone. Confirm dates and times in plain words.
- Money is in South African rand (ZAR).
- Do not use em dashes.
- When a customer wants to book, reserve or order, gather what the tool needs,
  then call the tool. Always confirm back what was booked and the reference.
- If a tool fails, apologise once, offer to try again or to pass the customer to
  the team. Never expose technical errors.`;

/** Build the full system prompt for one turn. */
export function buildSystemPrompt(
  pack: VerticalPack,
  config: ClientConfig,
): { cacheable: string; dynamic: string } {
  const cacheable = `${CORE_INSTRUCTIONS}\n\n---\n\n${pack.promptFragment.trim()}`;

  const dynamic = [
    `Business: ${config.name}`,
    config.location ? `Location: ${config.location}` : null,
    `Timezone: ${config.timezone}`,
    config.hours ? `Hours: ${JSON.stringify(config.hours)}` : null,
    config.services ? `Services: ${JSON.stringify(config.services)}` : null,
    config.menuLink ? `Menu: ${config.menuLink}` : null,
    config.resources ? `Resources: ${JSON.stringify(config.resources)}` : null,
    config.policies ? `Policies: ${JSON.stringify(config.policies)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return { cacheable, dynamic };
}
