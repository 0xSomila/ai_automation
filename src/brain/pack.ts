import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface ResourceModel {
  kind: "single" | "per_staff" | "covers";
  capacityPerSlot?: number;
}

export interface Pack {
  vertical: string;
  intents: string[];
  tools: string[];
  templates: string[];
  resourceModel: ResourceModel;
  promptFragment: string; // resolved text of prompt.md
}

const here = dirname(fileURLToPath(import.meta.url));
const verticalsDir = join(here, "..", "..", "verticals");

export function loadPack(vertical: string): Pack {
  const dir = join(verticalsDir, vertical);
  const meta = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
  const promptFragment = readFileSync(join(dir, "prompt.md"), "utf8");
  return {
    vertical: meta.vertical,
    intents: meta.intents ?? [],
    tools: meta.tools ?? [],
    templates: meta.templates ?? [],
    resourceModel: meta.resourceModel ?? { kind: "single" },
    promptFragment,
  };
}
