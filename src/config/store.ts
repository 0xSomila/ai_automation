import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "./types";
import { loadConfig, resolveBusinessByPhoneNumberId as resolveFromFiles } from "./load";

// Config source of truth. When Supabase is configured, client configs live in the
// `businesses` table (onboarding is a row, no redeploy); otherwise they are the
// files under clients/. The DB path falls back to files during migration, so the
// reference configs keep working before they are seeded. See ROADMAP Phase 7.

const here = dirname(fileURLToPath(import.meta.url));
const clientsDir = join(here, "..", "..", "clients");

let supa: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  if (!supa) supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  return supa;
}

const VERTICALS = ["practitioner", "restaurant", "salon", "service"];

// Hand-rolled validator (no extra dependency). Throws a readable error listing
// everything wrong, so a bad config is rejected at onboard time, not at runtime.
export function validateConfig(raw: unknown): Config {
  const errs: string[] = [];
  const c = raw as Partial<Config>;
  if (!c || typeof c !== "object") throw new Error("config must be an object");
  if (!c.slug) errs.push("slug is required");
  if (!c.vertical || !VERTICALS.includes(c.vertical)) errs.push(`vertical must be one of ${VERTICALS.join(", ")}`);
  if (!c.practice?.name) errs.push("practice.name is required");
  if (!c.practice?.timezone) errs.push("practice.timezone is required");
  if (!c.hours || typeof c.hours !== "object") errs.push("hours is required");
  if (!Array.isArray(c.services)) errs.push("services must be an array");
  if (!c.booking || typeof c.booking.slotStepMin !== "number") errs.push("booking.slotStepMin is required");
  if (!c.channels?.whatsappNumberId) errs.push("channels.whatsappNumberId is required");
  if (errs.length) throw new Error(`Invalid config:\n  - ${errs.join("\n  - ")}`);
  return raw as Config;
}

// Load a client config by slug: DB first (if configured), then file fallback.
export async function getConfig(slug: string): Promise<Config> {
  const client = db();
  if (client) {
    const { data, error } = await client.from("businesses").select("config").eq("slug", slug).maybeSingle();
    if (error) throw error;
    if (data?.config) return validateConfig(data.config);
  }
  return loadConfig(slug); // file fallback (throws if absent)
}

// Resolve an inbound WhatsApp phone_number_id to a client slug: DB first, then files.
export async function resolveBusiness(phoneNumberId: string): Promise<string | null> {
  const client = db();
  if (client) {
    const { data, error } = await client
      .from("businesses")
      .select("slug")
      .filter("config->channels->>whatsappNumberId", "eq", phoneNumberId)
      .maybeSingle();
    if (error) throw error;
    if (data?.slug) return data.slug;
  }
  return resolveFromFiles(phoneNumberId);
}

// Create or update a client config. DB upsert when configured, else write the file.
export async function upsertConfig(config: Config): Promise<"db" | "file"> {
  validateConfig(config);
  const client = db();
  if (client) {
    const { error } = await client
      .from("businesses")
      .upsert({ slug: config.slug, vertical: config.vertical, config }, { onConflict: "slug" });
    if (error) throw error;
    return "db";
  }
  writeFileSync(join(clientsDir, `${config.slug}.json`), JSON.stringify(config, null, 2) + "\n");
  return "file";
}

export async function listConfigs(): Promise<{ slug: string; vertical: string }[]> {
  const client = db();
  if (client) {
    const { data, error } = await client.from("businesses").select("slug, vertical").order("slug");
    if (error) throw error;
    return (data ?? []) as { slug: string; vertical: string }[];
  }
  return readdirSync(clientsDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => {
      const cfg = JSON.parse(readFileSync(join(clientsDir, f), "utf8")) as Config;
      return { slug: cfg.slug, vertical: cfg.vertical };
    });
}
