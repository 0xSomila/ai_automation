# Scripted test conversations

One folder of cases per vertical. Each case is a JSON script: an ordered list of
customer turns and what the receptionist must get right (a tool it should call,
a fact it must not invent, a confirmation it must give).

Run them against the handler with the backend stubbed to deterministic
availability, so the same script gives the same result every time.

Case shape:

```json
{
  "name": "books an initial consultation",
  "vertical": "practitioner",
  "client": "meridian",
  "turns": [
    { "customer": "hi, do you take new patients?" },
    { "customer": "I'd like a first appointment this week", "expectTool": "check_availability" },
    { "customer": "Tuesday morning works", "expectTool": "book_appointment", "expectReply": ["reference", "Tuesday"] }
  ]
}
```

`expectTool` asserts the brain called that tool on that turn. `expectReply`
asserts the reply contains each string (case-insensitive). Keep assertions about
behaviour, not exact wording. Tools in the current build: `check_availability`,
`book_appointment`.

## Running

```bash
npm run test:conversations          # run active cases (needs ANTHROPIC_API_KEY)
npm run test:conversations -- --dry # parse and list cases, no API calls
```

The runner (`test/run.ts`) drives each case through the handler with fresh in-memory
Store and BookingBackend adapters, one conversation per case. It exits non-zero on any
active failure.

## Pending cases

A case with `"pending": true` (and a `pendingReason`) is skipped and reported, not run.
The restaurant (covers) and salon (per-staff) cases need resource-model overrides, and
the service case needs a lead-capture tool; all three also need their client configs.
They become active in Phases 5 and 6. The practitioner case (`meridian`) is the active
gate for Phase 1.
