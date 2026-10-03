import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The message-template layer. Templates live per pack under
// verticals/<vertical>/templates/<name>.txt with {{placeholders}}. The Core
// renders them with engagement data. Vertical copy never enters Core code; the
// Core only substitutes. See CLAUDE.md and n8n/ARCHITECTURE.md.

const here = dirname(fileURLToPath(import.meta.url));
const verticalsDir = join(here, "..", "verticals");

export function loadTemplate(vertical: string, name: string): string {
  return readFileSync(join(verticalsDir, vertical, "templates", `${name}.txt`), "utf8").trim();
}

// Substitute {{key}} with vars[key]. Unresolved placeholders are removed and
// doubled spaces collapsed, so a missing optional field never leaks braces.
export function renderTemplate(body: string, vars: Record<string, string | undefined>): string {
  const filled = body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
  return filled.replace(/[ \t]{2,}/g, " ").trim();
}

// The reminder template a pack uses, by convention the one named *_reminder.
export function reminderTemplateName(templates: string[]): string | undefined {
  return templates.find((t) => t.endsWith("_reminder"));
}
