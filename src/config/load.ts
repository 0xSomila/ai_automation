import { readFileSync } from "node:fs";
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
