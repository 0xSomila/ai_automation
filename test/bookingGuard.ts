import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MemoryStore } from "../src/db/memory.js";
import { MemoryBackend } from "../src/booking/memory.js";
import { MemoryNotifier } from "../src/channel/notifier.js";
import { handleMessage } from "../src/handler.js";

// Regression for the live failure (Sat 28 Nov, "Trevor McCain"): the model wrote a
// booking confirmation without calling book_appointment, the guard retried, the
// model did it again, and the customer got a dead-end message. The retry must now
// force the tool call, and a forced call must not invent the customer's name.
// The Anthropic network layer is mocked, so no API key or network is needed.
//   npm run test:booking-guard

process.env.ANTHROPIC_API_KEY = "test-key";

type Scripted = { content: unknown[]; stop_reason: "end_turn" | "tool_use" };
let script: Scripted[] = [];
const requests: Record<string, any>[] = [];

// Local stand-in for the Messages API. Nothing leaves the machine.
const mock = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    requests.push(JSON.parse(raw || "{}"));
    const next = script.shift();
    if (!next) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "api_error", message: "model called more times than scripted" } }));
      return;
    }
    const body = { id: "msg_test", type: "message", role: "assistant", model: "test", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 }, ...next };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
});
await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

function nextMonday(): string {
  const d = new Date(Date.now() + 2 * 864e5);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const text = (t: string): Scripted => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn" });
const book = (name: string, date: string): Scripted => ({
  content: [{ type: "tool_use", id: "tu_1", name: "book_appointment", input: { name, service: "Sports massage", date, time: "12:00" } }],
  stop_reason: "tool_use",
});

async function scenario(customerSays: string, replies: Scripted[]) {
  const store = new MemoryStore();
  const backend = new MemoryBackend();
  const deps = { store, backend, notifier: new MemoryNotifier() };
  const from = "+27820007777";
  const customer = await store.getOrCreateCustomer("meridian", from);
  const conv = await store.getOrCreateConversation("meridian", customer.id);
  const date = nextMonday();
  await store.appendMessage(conv, { role: "user", content: "I want to book a sports massage for Monday" });
  await store.appendMessage(conv, { role: "assistant", content: "Great! What time on Monday would suit you?" });
  await store.appendMessage(conv, { role: "user", content: "12:00" });
  await store.appendMessage(conv, { role: "assistant", content: "Perfect, 12:00 on Monday is available for your sports massage. What's your name, please?" });
  script = [...replies];
  requests.length = 0;
  const reply = await handleMessage(deps, { businessSlug: "meridian", from, text: customerSays });
  return { reply, backend, date, store };
}

async function main(): Promise<void> {
  const date = nextMonday();

  // 1. The live failure: confirmation with no tool call, then a forced retry that books.
  const a = await scenario("Trevor McCain", [text("Your booking is confirmed! Reference C7-FAKE."), book("Trevor McCain", date)]);
  assert.equal(requests.length, 2, "one normal round, one forced retry");
  assert.equal(requests[0].tool_choice, undefined, "first round is not forced");
  assert.deepEqual(requests[1].tool_choice, { type: "tool", name: "book_appointment" }, "retry forces the booking tool");
  assert.match(a.reply, /C7-[A-Z0-9]{4}/, "reply carries a real reference from the tool");
  assert.ok(!/C7-FAKE/.test(a.reply), "the invented reference never reaches the customer");
  assert.equal((await a.backend.getBusy(a.date, "Africa/Johannesburg")).length, 1, "the booking really exists on the calendar");

  // 2. A forced call that invents the name is rejected, and nothing is booked.
  const b = await scenario("yes please", [text("You're all booked, see you then!"), book("Jane Doe", date), text("Could I have your name, please?")]);
  assert.equal((await b.backend.getBusy(b.date, "Africa/Johannesburg")).length, 0, "no booking from an invented name");
  assert.match(b.reply, /name/i);

  // 3. If the model still refuses to call the tool, the customer gets an actionable message.
  const c = await scenario("Trevor McCain", [text("Your booking is confirmed!"), text("You are booked in for 12:00.")]);
  assert.match(c.reply, /full name and the day and time/);
  assert.equal((await c.backend.getBusy(c.date, "Africa/Johannesburg")).length, 0);

  console.log("booking guard: all checks passed");
  mock.close();
}

main().catch((e) => {
  console.error(e);
  mock.close();
  process.exit(1);
});
