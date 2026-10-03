import "dotenv/config";

// Production preflight. Verifies the env a live deployment needs, grouped by
// concern, and exits non-zero if anything required is missing. Run before go-live:
//   npm run check:env

interface Check {
  key: string;
  required: boolean;
  group: string;
}

const checks: Check[] = [
  { key: "ANTHROPIC_API_KEY", required: true, group: "brain" },
  { key: "CLAUDE_MODEL", required: false, group: "brain" },

  { key: "SUPABASE_URL", required: true, group: "database" },
  { key: "SUPABASE_SERVICE_KEY", required: true, group: "database" },

  { key: "WHATSAPP_TOKEN", required: true, group: "whatsapp" },
  { key: "WHATSAPP_PHONE_NUMBER_ID", required: true, group: "whatsapp" },
  { key: "WHATSAPP_VERIFY_TOKEN", required: true, group: "whatsapp" },
  { key: "WHATSAPP_APP_SECRET", required: true, group: "whatsapp" },

  { key: "GOOGLE_CALENDAR_ID", required: true, group: "calendar" },
  { key: "GOOGLE_SERVICE_ACCOUNT_JSON", required: true, group: "calendar" },

  { key: "N8N_WEBHOOK_SECRET", required: true, group: "scheduling" },
  { key: "PORT", required: false, group: "runtime" },
];

function main(): void {
  let missing = 0;
  let lastGroup = "";
  for (const c of checks) {
    if (c.group !== lastGroup) {
      console.log(`\n[${c.group}]`);
      lastGroup = c.group;
    }
    const present = Boolean(process.env[c.key]);
    const mark = present ? "ok  " : c.required ? "MISS" : "--  ";
    if (!present && c.required) missing++;
    console.log(`  ${mark} ${c.key}${!present && !c.required ? " (optional)" : ""}`);
  }

  if (missing > 0) {
    console.log(`\n${missing} required variable(s) missing. Not ready for go-live.`);
    process.exit(1);
  }
  console.log("\nAll required variables present. Ready for go-live checks.");
}

main();
