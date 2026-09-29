/**
 * The one handler that runs every vertical. The only thing that changes per
 * business is which pack and config it loads. See BUILD.md section 11.
 *
 * Assemble a turn:
 *  1. Inbound webhook gives the WhatsApp number and message.
 *  2. Look up the business by number; load its config and vertical.
 *  3. Load the vertical pack (intents, tools, prompt fragment).
 *  4. Build the system prompt (cache core + fragment).
 *  5. Give Claude only the tools the pack lists.
 *  6. Run the tool-loop.
 *  7. Send the reply, persist messages, update engagements.
 */
import { loadConfig } from "./config/loader.js";
import { loadPack } from "./pack.js";
import { makeBackend } from "./booking/adapter.js";
import { runTurn, type Turn } from "./brain/claude.js";
import type { ToolContext } from "./brain/tools.js";
import {
  appendMessage,
  claimMessage,
  findBusinessByChannel,
  getOrOpenConversation,
  recentMessages,
  upsertCustomer,
} from "./db/queries.js";
import type { InboundMessage } from "./channel/whatsapp.js";
import { sendText } from "./channel/whatsapp.js";

// Register backends by importing them for their side effects.
import "./booking/googleCalendar.js";

const CUSTOMER_FALLBACK =
  "Thanks for your message. We are having a technical issue right now. The team will get back to you shortly.";

export async function handleInbound(msg: InboundMessage): Promise<void> {
  const business = await findBusinessByChannel(msg.phoneNumberId);
  if (!business) {
    console.error("No business for phoneNumberId", msg.phoneNumberId);
    return;
  }

  // Dedupe: Meta re-delivers. Process each provider message id at most once.
  const fresh = await claimMessage(msg.messageId, business.id);
  if (!fresh) {
    console.log("Skipping already-processed message", msg.messageId);
    return;
  }

  try {
    const config = loadConfig(business.config, business.slug);
    const pack = await loadPack(business.vertical);
    const backend = makeBackend(config.booking.backend, config.booking.config);

    const customer = await upsertCustomer(business.id, msg.from);
    const conversation = await getOrOpenConversation(business.id, customer.id);

    await appendMessage(conversation.id, "user", msg.text);
    const history = (await recentMessages(conversation.id)) as Turn[];

    const toolCtx: ToolContext = {
      config,
      pack,
      backend,
      businessId: business.id,
      customerId: customer.id,
      customerPhone: msg.from,
    };

    const reply = await runTurn(history, pack, config, toolCtx);

    await appendMessage(conversation.id, "assistant", reply);
    await sendText(msg.phoneNumberId, msg.from, reply);
  } catch (err) {
    console.error("handleInbound failed", business.slug, err);
    try {
      await sendText(msg.phoneNumberId, msg.from, CUSTOMER_FALLBACK);
    } catch (sendErr) {
      console.error("fallback send failed", sendErr);
    }
  }
}
