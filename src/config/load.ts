import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Config } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const clientsDir = join(here, "..", "..", "clients");

export function loadConfig(slug: string): Config {
  const raw = readFileSync(join(clientsDir, `${slug}.json`), "utf8");
  const cfg = JSON.parse(raw) as Config;
  if (!cfg.slug || !cfg.practice?.name || !Array.isArray(cfg.services)) {
    throw new Error(`Invalid config for "${slug}": missing required fields`);
  }
  return cfg;
}

// Multi-tenant routing: map an inbound WhatsApp phone_number_id to a client slug
// by scanning the client configs (config.channels.whatsappNumberId). File-based,
// so onboarding a client is still a config, not code. Cached after the first scan.
let channelIndex: Map<string, string> | null = null;

function buildChannelIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const file of readdirSync(clientsDir)) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    try {
      const cfg = JSON.parse(readFileSync(join(clientsDir, file), "utf8")) as Config;
      const id = cfg.channels?.whatsappNumberId;
      if (id && id !== "REPLACE_ME") index.set(id, cfg.slug);
    } catch {
      // Skip malformed config files; loadConfig surfaces the error when used directly.
    }
  }
  return index;
}

export function resolveBusinessByPhoneNumberId(phoneNumberId: string): string | null {
  if (!channelIndex) channelIndex = buildChannelIndex();
  return channelIndex.get(phoneNumberId) ?? null;
}

// For tests: drop the cache so a freshly written config is picked up.
export function resetChannelIndex(): void {
  channelIndex = null;
}
