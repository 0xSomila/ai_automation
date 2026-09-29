# C7 Automation OS

One engine, many verticals. A WhatsApp-first AI receptionist platform for appointment and reservation businesses.

Built by Catalyst 7. Delivery cell: Somila (lead), Tshiamo (build), Themba (config and sign-off).

## The mental model

Build the **Core** once (channel, brain, state, scheduler). Everything that differs between a physio, a restaurant and a salon lives in a **Vertical Pack**. A live client is a **Vertical Pack + a Client Config**.

- To launch a new vertical you write a pack, not a new app.
- To onboard a client you write a config, not code.

```
Core engine
  |
  +-- Vertical Pack: practitioner   --> Client Config: Meridian Physiotherapy
  +-- Vertical Pack: restaurant     --> Client Config: <a cafe>
  +-- Vertical Pack: salon          --> Client Config: <a salon>
  +-- Vertical Pack: service        --> Client Config: <a home-service business>
```

## Layers, never mixed

| Layer | Lives in | Changes when |
| --- | --- | --- |
| Core (vertical-agnostic) | `core/` | The engine itself changes, once for all verticals |
| Vertical Pack (per vertical) | `verticals/<name>/` | You add or change how a vertical behaves |
| Client Config (per business) | `clients/<slug>.json` | You onboard or update a business |

Business data never enters code. Vertical logic never enters a client config.

## Repo layout

```
core/         the engine: brain, channel, booking, db, config, handler
verticals/    one folder per vertical (practitioner, restaurant, salon, service)
clients/      one JSON config per business (+ _template.json)
n8n/          scheduled + inbound workflow exports
test/         scripted conversations per vertical
```

## Getting started

1. Copy `.env.example` to `.env` and fill it in. Never commit `.env`.
2. `npm install`
3. Apply `core/db/schema.sql` to your Supabase project.
4. Read `BUILD.md` for the full spec and `CLAUDE.md` for the working rules.

## Docs

- `BUILD.md` is the source of truth for the platform design.
- `CLAUDE.md` is the working ruleset for anyone (human or agent) writing code here.
