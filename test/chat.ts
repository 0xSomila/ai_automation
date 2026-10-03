import "dotenv/config";
import readline from "node:readline";
import { MemoryStore } from "../src/db/memory";
import { MemoryBackend } from "../src/booking/memory";
import { handleMessage } from "../src/handler";

// Terminal chat with the receptionist. Needs only ANTHROPIC_API_KEY.
// Usage: npm run chat            (defaults to the meridian config)
//        npm run chat -- salon   (any client slug under clients/)
const deps = { store: new MemoryStore(), backend: new MemoryBackend() };
const slug = process.argv[2] || "meridian";
const from = "dev-user";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log(`\nChatting with "${slug}". Type a message, or "exit".\n`);

function ask(): void {
  rl.question("you: ", async (text) => {
    if (text.trim().toLowerCase() === "exit") return rl.close();
    try {
      const reply = await handleMessage(deps, { businessSlug: slug, from, text });
      console.log(`\nbot: ${reply}\n`);
    } catch (e) {
      console.error("error:", (e as Error).message);
    }
    ask();
  });
}
ask();
