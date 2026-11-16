import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MemoryStore } from "../src/db/memory";
import type { Engagement } from "../src/db/types";
import { MemoryBackend } from "../src/booking/memory";
import { MemoryNotifier } from "../src/channel/notifier";
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
  expectBooking?: Pick<Engagement, "kind" | "service" | "party">;
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

class ConversationStore extends MemoryStore {
  readonly created: Engagement[] = [];

  override async createEngagement(input: Omit<Engagement, "id">): Promise<Engagement> {
    const engagement = await super.createEngagement(input);
    this.created.push(engagement);
    return engagement;
  }
}

function loadCases(): { file: string; data: Case }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, data: JSON.parse(readFileSync(join(dir, f), "utf8")) as Case }));
}

async function runCase(c: Case): Promise<string[]> {
  const failures: string[] = [];
  const store = new ConversationStore();
  const deps = { store, backend: new MemoryBackend(), notifier: new MemoryNotifier() };
  const from = `test-${c.client}`;

  for (let i = 0; i < c.turns.length; i++) {
    const turn = c.turns[i];
    const before = store.created.length;
    const label = `turn ${i + 1}`;
    const toolsThisTurn: string[] = [];
    const reply = await handleMessage(
      deps,
      { businessSlug: c.client, from, text: turn.customer },
      { onToolUse: (name) => toolsThisTurn.push(name) },
    );

    if (turn.expectTool && !toolsThisTurn.includes(turn.expectTool)) {
      failures.push(
        `${label}: expected tool "${turn.expectTool}", got [${toolsThisTurn.join(", ") || "none"}]`,
      );
    }
    for (const s of turn.expectReply ?? []) {
      if (!reply.toLowerCase().includes(s.toLowerCase())) {
        failures.push(`${label}: reply missing "${s}". Reply was: ${reply}`);
      }
    }
    if (turn.expectBooking) {
      const bookings = store.created.slice(before).filter(({ status }) => status === "confirmed");
      if (bookings.length !== 1) {
        failures.push(`${label}: expected one confirmed booking, got ${bookings.length}`);
        continue;
      }

      const [booking] = bookings;
      for (const field of ["kind", "service", "party"] as const) {
        const expected = turn.expectBooking[field];
        if (expected !== undefined && booking[field] !== expected) {
          failures.push(`${label}: expected booking ${field} ${expected}, got ${booking[field]}`);
        }
      }
      if (!booking.reference || !reply.includes(booking.reference)) {
        failures.push(`${label}: reply missing the saved booking reference. Reply was: ${reply}`);
      }
    }
  }
  return failures;
}

async function main(): Promise<void> {
  if (!dry && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error("Set ANTHROPIC_API_KEY in .env or in your environment to run the live conversation tests.");
    process.exitCode = 1;
    return;
  }

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
