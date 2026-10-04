import "dotenv/config";
import { readFileSync } from "node:fs";
import { getConfig, listConfigs, upsertConfig, validateConfig } from "./config/store";

// Onboard or update a client from a config file, or list clients. The config
// store writes to the businesses table when Supabase is configured (no redeploy),
// otherwise to clients/<slug>.json. This is the "config, not code" surface.
//
//   npm run onboard -- clients/harbour.json     validate + upsert a client
//   npm run onboard -- --list                   list onboarded clients
//   npm run onboard -- --show <slug>            print a client's resolved config

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === "--list") {
    const rows = await listConfigs();
    if (rows.length === 0) {
      console.log("No clients found.");
      return;
    }
    for (const r of rows) console.log(`  ${r.slug}  (${r.vertical})`);
    return;
  }

  if (args[0] === "--show") {
    const slug = args[1];
    if (!slug) throw new Error("usage: --show <slug>");
    console.log(JSON.stringify(await getConfig(slug), null, 2));
    return;
  }

  const path = args[0];
  if (!path) {
    console.log("usage: npm run onboard -- <config.json> | --list | --show <slug>");
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(path, "utf8"));
  const config = validateConfig(raw); // throws with a readable list if invalid
  const where = await upsertConfig(config);
  console.log(`Onboarded "${config.slug}" (${config.vertical}) to the ${where}.`);
  if (config.channels.whatsappNumberId === "REPLACE_ME") {
    console.log("Note: channels.whatsappNumberId is still REPLACE_ME; set the real number before go-live.");
  }
}

main().catch((e) => {
  console.error("onboard failed:", (e as Error).message);
  process.exit(1);
});
