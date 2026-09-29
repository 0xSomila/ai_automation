/**
 * Vertical pack contract and loader (Core side).
 *
 * A pack lives under verticals/<name>/ with pack.json, prompt.md and
 * availability.ts. Core loads it and hands the brain only what the pack lists.
 * Adding a vertical is a new folder here, never an edit to Core control flow.
 *
 * See BUILD.md sections 6 and 11.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Slot } from "./booking/primitive.js";
import type { BookingBackend } from "./booking/adapter.js";
import type { ClientConfig } from "./config/loader.js";
import type { ToolName } from "./brain/tools.js";

export interface EntitySpec {
  required: string[];
  optional?: string[];
}

export interface PackManifest {
  vertical: string;
  intents: string[];
  tools: ToolName[];
  entities: Record<string, EntitySpec>;
  resourceModel: {
    kind: "single" | "per_staff" | "covers";
    capacityPerSlot?: number;
  };
  templates: string[];
  promptFragment: string; // filename, e.g. "prompt.md"
}

/** Args every availability function receives. */
export interface AvailabilityArgs {
  config: ClientConfig;
  backend: BookingBackend;
  date: string; // ISO date "YYYY-MM-DD" in the client's timezone
  service?: string;
  party?: number;
  staff?: string;
}

/** Each pack's availability.ts default-exports this. */
export type ComputeAvailability = (args: AvailabilityArgs) => Promise<Slot[]>;

export interface VerticalPack {
  manifest: PackManifest;
  promptFragment: string;
  computeAvailability: ComputeAvailability;
}

const cache = new Map<string, VerticalPack>();

function packDir(vertical: string): string {
  return join(process.cwd(), "verticals", vertical);
}

/** Load, validate and cache a vertical pack by name. */
export async function loadPack(vertical: string): Promise<VerticalPack> {
  const cached = cache.get(vertical);
  if (cached) return cached;

  const dir = packDir(vertical);
  const manifest = JSON.parse(
    await readFile(join(dir, "pack.json"), "utf8"),
  ) as PackManifest;

  if (manifest.vertical !== vertical) {
    throw new Error(
      `Pack manifest vertical "${manifest.vertical}" does not match folder "${vertical}"`,
    );
  }

  const promptFragment = await readFile(join(dir, manifest.promptFragment), "utf8");

  const mod = (await import(join(dir, "availability.js"))) as {
    default: ComputeAvailability;
  };
  if (typeof mod.default !== "function") {
    throw new Error(`verticals/${vertical}/availability must default-export a function`);
  }

  const pack: VerticalPack = {
    manifest,
    promptFragment,
    computeAvailability: mod.default,
  };
  cache.set(vertical, pack);
  return pack;
}
