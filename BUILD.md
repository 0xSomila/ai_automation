# C7 Automation OS: Build Spec (all verticals)

Full build context for C7's AI automation platform. One engine, many verticals. Hand this file to Claude Code as the source of truth. Keep it in the repo root as `BUILD.md`; put the "Working rules" (section 13) in `CLAUDE.md`.

Owner: Catalyst 7. Delivery cell: Somila (lead), Tshiamo (build), Themba (config and sign-off).

> **Implementation note (reflects the current repo).** This spec is the north star. The shipped code lives under `src/` (not `core/`); see `README.md` and `CLAUDE.md` for the actual layout. The current build ships two tools, `check_availability` and `book_appointment`, running against swappable store and booking backends (in-memory for dev, Supabase + Google Calendar for prod); the wider tool library in section 7 is the roadmap. Inbound WhatsApp is handled directly by `src/server.ts` `/webhook`; n8n runs the scheduled jobs via `/cron/*` (see `n8n/ARCHITECTURE.md`).

The mental model: build the **Core** once (channel, brain, state, scheduler). Everything that differs between a physio, a restaurant and a salon lives in a **Vertical Pack**. A live client is a **Vertical Pack + a Client Config**. To launch a new vertical you write a pack, not a new app. To onboard a client you write a config, not code.

---

## 1. Why a platform, not one bot

Every appointment or reservation business runs the same shape: a customer messages, asks the same questions, wants to book or reserve, needs reminding, and should come back. The differences are shallow and nameable: what gets booked (a practitioner's time, a table for six, a stylist and a chair), what the business sells (services, a menu, treatments), and a few vertical-specific intents (catering enquiry, party booking, walk-in waitlist).

So the booking and conversation logic is shared. Verticals differ only in config, a resource model, an intent set, and message templates. Build the shared 80% once. Each new vertical is the remaining 20%.

If one vertical stalls commercially, you keep the Core and the other packs. Nothing is wasted.

---

## 2. Core vs Vertical Pack vs Client Config

**Core (built once, vertical-agnostic):**

- Channel adapter (WhatsApp Cloud API; Instagram later)
- Conversation brain (Claude tool-loop, prompt caching)
- State store (Supabase: customers, conversations, messages, engagements)
- Scheduler (n8n: reminders, follow-up, reactivation, waitlist)
- Booking primitive (resource + capacity + duration + time)
- Config loader and validator

**Vertical Pack (one per vertical: practitioner, restaurant, salon, ...):**

- Intent set (what the receptionist can handle in this vertical)
- Entity schema (what a booking needs: party size, service, staff, etc.)
- Tool set (which tools the brain gets, composed from the shared tool library)
- Resource model (what capacity is booked against)
- Message templates (reminder, follow-up, and vertical-specific ones)
- System-prompt fragment (vertical framing and rules)

**Client Config (one per business):**

- The vertical pack it uses
- The business data: name, location, hours, services or menu, prices (ZAR), policies, resources, channel number

```
Core engine
  |
  +-- Vertical Pack: practitioner   --> Client Config: Meridian Physiotherapy
  +-- Vertical Pack: restaurant     --> Client Config: <a cafe>
  +-- Vertical Pack: salon          --> Client Config: <a salon>
  +-- Vertical Pack: service (generic) --> Client Config: <a home-service business>
```

---

## 3. Architecture (shared across all verticals)

```
Customer (WhatsApp / Instagram)
        |
        v
Meta Cloud API webhook  ->  n8n (orchestration)
        |
        v
Core brain (Claude, tool-loop)
   loads: client config + vertical pack (intents, tools, prompt fragment)
        |
        v
Shared tool library (the pack selects which apply):
  answer_faq | qualify | check_availability | create_booking |
  reschedule | cancel | join_waitlist | take_order | capture_lead
        |
        v
Resource + booking backend (adapter per client)
        |
        v
Scheduled workflows (n8n): reminders, follow-up, reactivation, waitlist release
```

The brain never invents availability. It calls `check_availability`. The booking backend is behind an adapter so each client's real system (Google Calendar, a practice-management system, a reservations tool) plugs in.

---

## 4. Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Channel | WhatsApp Cloud API (Meta, direct) | No BSP. Same code for every vertical. |
| Orchestration | n8n, self-hosted (Docker) | The n8n MCP connector is currently down; build via the n8n UI or REST API. |
| Brain | Claude Haiku 4.5 | Prompt caching on the fixed core prompt + pack fragment. |
| Booking backend | Adapter interface | Google Calendar as the reference; per-client implementations plug in. |
| State | Supabase (Postgres) | Shared schema, vertical differences held in JSON columns. |
| Web assets | Vercel | Optional config admin, landing pages. |

Validate WhatsApp and Claude pricing at contract time; rates shift.

---

## 5. The booking primitive (how one model serves every vertical)

Do not model "appointments" and "reservations" separately. Model one primitive:

```
Engagement = {
  resource,          # what is being consumed (a practitioner, a table, a stylist+chair)
  capacity,          # how much (1 slot, or covers/seats for a party)
  duration,          # minutes the resource is held
  startsAt,          # the time
  party,             # people count where it matters (restaurant, group class)
  service            # the named thing sold (service, menu sitting, treatment)
}
```

- **Practitioner:** resource = practitioner time, capacity = 1, duration = service length, party = 1.
- **Restaurant:** resource = table capacity, capacity = covers, duration = sitting length, party = guests.
- **Salon:** resource = staff member (and chair), capacity = 1, duration = service length, party = 1.

`check_availability` and `create_booking` operate on this primitive. Each vertical pack supplies how to compute availability for its resource model, and the backend adapter supplies the actual busy data.

---

## 6. Vertical Pack definition

A pack is a folder under `verticals/<name>/` with:

```
verticals/practitioner/
  pack.json          # intents, entities, tools, resource model, templates
  prompt.md          # system-prompt fragment for this vertical
  availability.ts    # how to compute open slots for this resource model
```

`pack.json` shape:

```json
{
  "vertical": "practitioner",
  "intents": ["faq", "qualify", "book", "reschedule", "cancel", "reactivate"],
  "tools": ["answer_faq", "check_availability", "create_booking", "reschedule", "cancel"],
  "entities": {
    "booking": { "required": ["name", "service", "date", "time"], "optional": ["firstVisit"] }
  },
  "resourceModel": { "kind": "single", "capacityPerSlot": 1 },
  "templates": ["appointment_reminder", "appointment_followup", "reactivation"],
  "promptFragment": "prompt.md"
}
```

Per-vertical variations of that file are in section 9.

---

## 7. Shared tool library

The Core defines every tool once; each pack lists which it uses. Executors read the client config and vertical pack, so one implementation serves all verticals.

| Tool | Purpose | Verticals |
| --- | --- | --- |
| `answer_faq` | Answer from config policies and services | all |
| `qualify` | Capture intent, service, party, urgency | all |
| `check_availability` | Open times for the resource model on a date | all bookable |
| `create_booking` | Commit an engagement, return a reference | all bookable |
| `reschedule` | Move an existing engagement | all bookable |
| `cancel` | Cancel an engagement | all bookable |
| `join_waitlist` | Add to waitlist when full | restaurant, salon, busy practices |
| `take_order` | Capture a takeaway or catering order | restaurant |
| `capture_lead` | Log an enquiry with no immediate booking | all |

Rules that hold for every executor: never trust the model's arguments, always re-validate against live availability before writing, always timezone-aware, always log the call and its outcome.

---

## 8. Data model (Supabase, shared)

```sql
create table businesses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  vertical text not null,            -- practitioner | restaurant | salon | service
  config jsonb not null,             -- the client config
  created_at timestamptz default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id),
  wa_phone text not null,
  name text,
  last_seen timestamptz default now(),
  unique (business_id, wa_phone)
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id),
  customer_id uuid references customers(id),
  status text default 'open',
  updated_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id),
  role text not null,                -- user | assistant | tool
  content text not null,
  created_at timestamptz default now()
);

create table engagements (             -- appointments AND reservations
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id),
  customer_id uuid references customers(id),
  kind text not null,                -- appointment | reservation | order | lead
  service text,
  resource text,                     -- practitioner, table, stylist
  party int default 1,
  starts_at timestamptz,
  duration_min int,
  status text default 'confirmed',   -- confirmed | cancelled | completed | no_show | waitlist
  reference text unique,
  backend_event_id text,
  reminder_sent_at timestamptz,
  followup_sent_at timestamptz,
  payload jsonb,                     -- vertical-specific extras (order lines, notes)
  created_at timestamptz default now()
);
```

Vertical differences live in `businesses.vertical`, `engagements.kind`, and the JSON columns. The relational shape never changes per vertical.

---

## 9. The vertical packs

### 9a. Practitioner (appointments)

Physios, dentists, chiros, therapists. Resource = practitioner time, capacity 1.

- Intents: faq, qualify, book, reschedule, cancel, reactivate.
- Config specifics: services with `durationMin` and `priceZar`; medical-aid and referral policies; cancellation policy.
- Templates: `appointment_reminder`, `appointment_followup`, `reactivation`.
- Reference client: Meridian Physiotherapy (already built as the demo).

### 9b. Restaurant (reservations, orders, enquiries)

Independent restaurants, cafes, takeaways. Resource = table covers, capacity = party size.

- Intents: faq, reserve, modify_reservation, cancel, catering_enquiry, event_enquiry, take_order, capture_lead.
- Config specifics: sittings and capacity (covers per slot), party-size limits, menu or menu link, catering and event contact rules, opening times per service (lunch, dinner).
- Availability: covers-based. `check_availability(date, party)` returns times where remaining covers >= party.
- Templates: `reservation_reminder`, `reservation_followup`, `event_enquiry_ack`.
- Extra tool: `take_order` for takeaway or catering, writing lines to `engagements.payload`.

### 9c. Salon and beauty (appointments with staff)

Salons, barbers, beauty clinics. Resource = staff member (and chair), capacity 1, but availability is per staff.

- Intents: faq, qualify, book, rebook, cancel, promotions, reactivate.
- Config specifics: services with duration and price; staff list and which services each performs; product or promo offers.
- Availability: per-staff. `check_availability(date, service, staff?)` returns open times across qualified staff, or for the chosen staff.
- Templates: `appointment_reminder`, `rebooking_nudge`, `promotion`, `reactivation`.

### 9d. Generic service (the template for new verticals)

Home services, tutors, trades, consultants. Resource = provider time, capacity 1, often quote-first.

- Intents: faq, qualify, capture_lead, book, reschedule, cancel.
- Config specifics: service catalogue, service area, quote rules (some jobs are quoted before booking).
- Use this pack as the starting point when spinning up a vertical C7 has not templated yet. Copy it, adjust intents, entities and templates, and you have a new pack in hours.

### Per-vertical difference table

| Dimension | Practitioner | Restaurant | Salon | Generic service |
| --- | --- | --- | --- | --- |
| Books against | Practitioner time | Table covers | Staff + chair | Provider time |
| Capacity unit | 1 slot | covers/party | 1 slot per staff | 1 slot |
| Key extra field | first visit | party size | chosen staff | quote needed |
| Signature intent | reschedule | catering/event | rebooking | lead capture |
| Extra tool | none | take_order | none | capture_lead |

---

## 10. Repo structure

```
c7-automation-os/
  README.md
  BUILD.md                 # this file
  CLAUDE.md                # working rules (section 13)
  .env.example
  core/
    brain/ systemPrompt.ts tools.ts claude.ts
    channel/ whatsapp.ts
    booking/ adapter.ts googleCalendar.ts primitive.ts
    db/ schema.sql queries.ts
    config/ loader.ts schema.json     # base config schema + validator
    handler.ts
  verticals/
    practitioner/ pack.json prompt.md availability.ts
    restaurant/   pack.json prompt.md availability.ts
    salon/        pack.json prompt.md availability.ts
    service/      pack.json prompt.md availability.ts
  clients/
    meridian.json            # practitioner reference config
    _template.json           # blank client config
  n8n/
    inbound.json reminders.json followup.json reactivation.json waitlist.json
  test/
    conversations/           # scripted cases per vertical
```

---

## 11. How the engine assembles a turn

1. Inbound webhook gives the WhatsApp number and message.
2. Look up the `business` by number, load its `config` and `vertical`.
3. Load the vertical pack (intents, tools, prompt fragment).
4. Build the system prompt: fixed Core instructions + vertical fragment + client config block (cache the first two).
5. Give Claude only the tools the pack lists.
6. Run the tool-loop: the executors read config + pack to behave correctly for that vertical.
7. Send the reply, persist messages, update engagements.

The same `handler.ts` runs every vertical. The only thing that changes is which pack and config it loaded.

---

## 12. Build sequence (log hours by category)

Categories: Core, Vertical Pack, Discovery/Config, Channel, Availability, Booking, Scheduling, Testing, Deployment.

**Phase 1: Core + first pack (practitioner)**

1. Provision: VPS + n8n, Supabase, Meta app + test number. [Core, Channel, Deployment]
2. Schema + config loader + validator. [Core]
3. Brain: prompt builder, tool library, Claude client with caching. Port the Meridian demo logic. [Core]
4. Booking primitive + Google Calendar adapter. [Core, Booking]
5. Practitioner pack: pack.json, prompt.md, availability.ts. Seed Meridian. [Vertical Pack, Discovery/Config]
6. Inbound + reminder + follow-up workflows. [Channel, Scheduling]
7. Run practitioner test conversations. [Testing]
8. Go live with one practitioner. [Deployment]

**Phase 2: second pack (restaurant OR salon, whichever has a live prospect)**

9. Write the pack: intents, entities, availability for its resource model, templates. [Vertical Pack]
10. Add `take_order` / covers availability as needed. [Booking, Availability]
11. Test conversations for that vertical. [Testing]

If Phase 2 needs Core changes beyond adding a tool or a pack, the abstraction leaked. Fix the Core, do not fork it. Target: a new pack is days, a new client on an existing pack is hours.

---

## 13. Working rules for Claude Code (put in CLAUDE.md)

- Three layers, never mixed: Core (vertical-agnostic), Vertical Pack (per vertical), Client Config (per business). Business data never enters code; vertical logic never enters a client config.
- One booking primitive (resource + capacity + duration + party). Do not add a parallel "reservation" model; extend the primitive.
- The model never invents availability. It comes only from `check_availability`, which reads the pack's resource model and the backend.
- Re-validate every slot inside `create_booking` before writing. Never trust tool arguments.
- Adding a vertical = a new folder under `verticals/`, never edits to Core control flow. If Core must change, change it once for all verticals.
- Timezone-aware everywhere (`Africa/Johannesburg`). Store UTC, present local.
- Money is ZAR. No em dashes in user-facing copy.
- Every external call wrapped, logged, with a clean customer-facing failure path.
- Secrets only in env. Never commit `.env` or a live client config with a real token.

---

## 14. Environment

```
CLAUDE_API_KEY=
CLAUDE_MODEL=claude-haiku-4-5
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
GOOGLE_CALENDAR_ID=
GOOGLE_SERVICE_ACCOUNT_JSON=
N8N_WEBHOOK_SECRET=
```

---

## 15. Isolating one vertical for a client

To stand up a client, you never touch Core:

1. Pick the vertical pack (or write one from `verticals/service/` if it is new).
2. Copy `clients/_template.json`, fill the business data and set `vertical`.
3. Plug the booking backend (Google Calendar, or a client-system adapter).
4. Register the WhatsApp number, submit that vertical's templates.
5. Insert the `businesses` row, seed it.
6. Run that vertical's test conversations.
7. Go live.

That is the promise of the platform: the practitioner build and the restaurant build share everything but a pack and a config, so whichever vertical finds clients first, the rest are a short step away, not a rebuild.
```
