import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MemoryStore } from "../src/db/memory.js";
import { MemoryBackend } from "../src/booking/memory.js";
import { MemoryNotifier } from "../src/channel/notifier.js";
import { handleMessage } from "../src/handler.js";
import { loadConfig } from "../src/config/load.js";
import { loadPack } from "../src/brain/pack.js";
import { executeTool } from "../src/brain/tools.js";

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

async function scenario(customerSays: string, replies: Scripted[] | ((reference: string) => Scripted[]), opts: { preBook?: boolean; earlier?: string[] } = {}) {
  const store = new MemoryStore();
  const backend = new MemoryBackend();
  const deps = { store, backend, notifier: new MemoryNotifier() };
  const from = "+27820007777";
  const customer = await store.getOrCreateCustomer("meridian", from);
  const conv = await store.getOrCreateConversation("meridian", customer.id);
  const date = nextMonday();
  for (const line of opts.earlier ?? []) await store.appendMessage(conv, { role: "user", content: line });
  await store.appendMessage(conv, { role: "user", content: "I want to book a sports massage for Monday" });
  await store.appendMessage(conv, { role: "assistant", content: "Great! What time on Monday would suit you?" });
  await store.appendMessage(conv, { role: "user", content: "12:00" });
  await store.appendMessage(conv, { role: "assistant", content: "Perfect, 12:00 on Monday is available for your sports massage. What's your name, please?" });
  let reference = "";
  if (opts.preBook) {
    const ctx = { config: loadConfig("meridian"), pack: loadPack("practitioner"), backend, store, businessId: "meridian", customerId: customer.id };
    const booked = JSON.parse(await executeTool("book_appointment", { name: "Somila Test", service: "Sports massage", date, time: "12:00" }, ctx));
    assert.equal(booked.status, "confirmed");
    reference = booked.reference;
  }
  script = typeof replies === "function" ? replies(reference) : [...replies];
  requests.length = 0;
  const reply = await handleMessage(deps, { businessSlug: "meridian", from, text: customerSays });
  return { reply, backend, date, store, reference };
}

const list: Scripted = { content: [{ type: "tool_use", id: "tu_l", name: "list_upcoming_bookings", input: {} }], stop_reason: "tool_use" };

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

  // 4. The live slip: "look up my appointments". The model lists the real booking, reference
  //    included. That reply must reach the customer untouched, with no retry and no forced booking.
  const d = await scenario("Look up my upcoming appointments", (ref) => [
    list,
    text(`You have one upcoming appointment: Sports massage on Mon, 30 Nov at 12:00, reference ${ref}.`),
  ], { preBook: true });
  assert.equal(requests.length, 2, "a lookup turn is two rounds with no guard retry");
  assert.ok(requests.every((r) => r.tool_choice === undefined), "nothing is forced on a lookup");
  assert.ok(/Sports massage/.test(d.reply) && d.reply.includes(d.reference), "customer sees their real booking");
  assert.equal((await d.backend.getBusy(d.date, "Africa/Johannesburg")).length, 1, "no extra booking was made");

  // 5. A lookup turn whose reply invents a reference is still caught, but never forced to book.
  const e = await scenario("Look up my upcoming appointments", [
    list,
    text("Your appointment is confirmed, reference C7-ZZZZ."),
    text("I could not find an upcoming appointment for you."),
  ]);
  assert.equal(requests.length, 3, "guard retried once");
  assert.equal(requests[2].tool_choice, undefined, "a lookup turn is never forced to book");
  assert.match(e.reply, /could not find/);
  assert.equal((await e.backend.getBusy(e.date, "Africa/Johannesburg")).length, 0, "nothing was booked");

  // 6. A name given earlier in the chat cannot be reused by a forced call on a later, unrelated message.
  const f = await scenario("ok thanks", [text("You're all booked, see you then!"), book("Trevor McCain", date), text("Could I have your name, please?")], {
    earlier: ["Hi, my name is Trevor McCain"],
  });
  assert.equal((await f.backend.getBusy(f.date, "Africa/Johannesburg")).length, 0, "no booking from a stale name");

  console.log("booking guard: all checks passed");
  mock.close();
}

main().catch((e) => {
  console.error(e);
  mock.close();
  process.exit(1);
});
