import "dotenv/config";
import assert from "node:assert";
import { writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveBusinessByPhoneNumberId, resetChannelIndex } from "../src/config/load";

// Phase 3 gate (routing side): an inbound WhatsApp phone_number_id resolves to the
// right client slug by scanning client configs. Unknown numbers resolve to null so
// the server can fall back. Needs no external services.
//   npm run test:routing

const here = dirname(fileURLToPath(import.meta.url));
const clientsDir = join(here, "..", "clients");
// .local.json is gitignored, so this probe never gets committed even if cleanup fails.
const probe = join(clientsDir, "zz-routeprobe.local.json");

async function main(): Promise<void> {
  writeFileSync(
    probe,
    JSON.stringify({ slug: "zz-routeprobe", channels: { whatsappNumberId: "PHONE_NUM_TEST_123" } }),
  );
  resetChannelIndex();

  try {
    assert.strictEqual(
      resolveBusinessByPhoneNumberId("PHONE_NUM_TEST_123"),
      "zz-routeprobe",
      "known number should resolve to its slug",
    );
    assert.strictEqual(
      resolveBusinessByPhoneNumberId("UNKNOWN_NUMBER"),
      null,
      "unknown number should resolve to null (server falls back)",
    );
    assert.strictEqual(
      resolveBusinessByPhoneNumberId("REPLACE_ME"),
      null,
      "placeholder numbers are ignored, not mapped",
    );
    console.log("routing test passed: phone_number_id -> slug resolution works");
  } finally {
    rmSync(probe, { force: true });
    resetChannelIndex();
  }
}

main().catch((e) => {
  rmSync(probe, { force: true });
  console.error("routing test FAILED:", (e as Error).message);
  process.exit(1);
});
