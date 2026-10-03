import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MemoryStore } from "../src/db/memory";
import { MemoryBackend } from "../src/booking/memory";
import { handleMessage } from "../src/handler";

// Runs the scripted conversations in test/conversations/*.json against the
// handler with fresh in-memory adapters per case. Asserts, per turn, that the
// expected tool fired (expectTool) and the reply contains each expectReply
// string. A case marked "pending": true is skipped and reported.
//
//   npm run test:conversations          run all active cases (needs ANTHROPIC_API_KEY)
//   npm run test:conversations -- --dry parse and list cases, no API calls

interface Turn {
  customer: string;
  expectTool?: string;
  expectReply?: string[];
}
interface Case {
  name: string;
  vertical: string;
  client: string;
  turns: Turn[];
  pending?: boolean;
  pendingReason?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "conversations");
const dry = process.argv.includes("--dry");

function loadCases(): { file: string; data: Case }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, data: JSON.parse(readFileSync(join(dir, f), "utf8")) as Case }));
}

async function runCase(c: Case): Promise<string[]> {
  const failures: string[] = [];
  const deps = { store: new MemoryStore(), backend: new MemoryBackend() };
  const from = `test-${c.client}`;

  for (let i = 0; i < c.turns.length; i++) {
    const turn = c.turns[i];
    const toolsThisTurn: string[] = [];
    const reply = await handleMessage(
      deps,
      { businessSlug: c.client, from, text: turn.customer },
      { onToolUse: (name) => toolsThisTurn.push(name) },
    );

    if (turn.expectTool && !toolsThisTurn.includes(turn.expectTool)) {
      failures.push(
        `turn ${i + 1}: expected tool "${turn.expectTool}", got [${toolsThisTurn.join(", ") || "none"}]`,
      );
    }
    for (const s of turn.expectReply ?? []) {
      if (!reply.toLowerCase().includes(s.toLowerCase())) {
        failures.push(`turn ${i + 1}: reply missing "${s}". Reply was: ${reply}`);
      }
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const cases = loadCases();
  let passed = 0;
  let failed = 0;
  let pending = 0;

  for (const { data: c } of cases) {
    if (c.pending) {
      pending++;
      console.log(`PENDING  ${c.name} (${c.pendingReason ?? "not ready"})`);
      continue;
    }
    if (dry) {
      console.log(`ACTIVE   ${c.name} [${c.vertical}/${c.client}, ${c.turns.length} turns]`);
      continue;
    }
    try {
      const failures = await runCase(c);
      if (failures.length === 0) {
        passed++;
        console.log(`PASS     ${c.name}`);
      } else {
        failed++;
        console.log(`FAIL     ${c.name}`);
        for (const f of failures) console.log(`           ${f}`);
      }
    } catch (e) {
      failed++;
      console.log(`ERROR    ${c.name}: ${(e as Error).message}`);
    }
  }

  console.log(
    `\n${dry ? "listed" : "ran"}: ${cases.length} cases, ${passed} passed, ${failed} failed, ${pending} pending`,
  );
  if (failed > 0) process.exit(1);
}

main();
