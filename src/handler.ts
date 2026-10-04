import { getConfig } from "./config/store";
import { loadPack } from "./brain/pack";
import { runBrain, type BrainHooks } from "./brain/claude";
import type { Store } from "./db/types";
import type { BookingBackend } from "./booking/adapter";
import type { Notifier } from "./channel/notifier";

export interface Deps {
  store: Store;
  backend: BookingBackend;
  notifier: Notifier;
}

// One inbound message, resolved to a reply string. The caller (chat
// harness or WhatsApp webhook) decides how to deliver it. `hooks` is optional
// observation (the test runner uses it to assert tool calls); production omits it.
export async function handleMessage(
  deps: Deps,
  args: { businessSlug: string; from: string; text: string },
  hooks?: BrainHooks,
): Promise<string> {
  const config = await getConfig(args.businessSlug);
  const pack = loadPack(config.vertical);
  const businessId = config.slug;

  const customer = await deps.store.getOrCreateCustomer(businessId, args.from);
  const conversationId = await deps.store.getOrCreateConversation(businessId, customer.id);

  return runBrain({
    config,
    pack,
    backend: deps.backend,
    store: deps.store,
    businessId,
    customerId: customer.id,
    conversationId,
    userText: args.text,
    hooks,
  });
}
