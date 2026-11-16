# Scripted test conversations

One folder of cases per vertical. Each case is a JSON script: an ordered list of
customer turns and what the receptionist must get right (a tool it should call,
a fact it must not invent, a confirmation it must give).

Run them against the handler with the live Claude API and fresh in-memory
booking and storage adapters.

Case shape:

```json
{
  "name": "books an initial consultation",
  "vertical": "practitioner",
  "client": "meridian",
  "turns": [
    { "customer": "hi, do you take new patients?" },
    { "customer": "Is 9am next Tuesday available for an initial consultation?", "expectTool": "check_availability" },
    { "customer": "Please book that slot. My name is Thandi.", "expectTool": "book_appointment", "expectBooking": { "kind": "appointment", "service": "Initial consultation" } }
  ]
}
```

`expectTool` asserts the brain called that tool on that turn. `expectReply`
asserts the reply contains each string (case-insensitive). `expectBooking` asserts
that the turn saved exactly one confirmed booking with the given `kind`, optional
`service` and optional `party`, and that the reply includes its saved reference.

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
Active: practitioner (`meridian`, single) and restaurant (`harbour`, covers). Pending: salon
(per-staff availability not built) and service (no lead-capture tool yet).
