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
asserts the reply contains each string. Keep assertions about behaviour, not exact
wording. Tools in the current build: `check_availability`, `book_appointment`.

These are target specs, not all passing yet. The restaurant (covers) and salon
(per-staff) cases assume resource-model overrides that are noted as pending in those
packs; the generic service pack has no lead-capture tool yet. A small runner that
drives these against the handler with a deterministic in-memory backend is the next
testing step.
