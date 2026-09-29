# Working rules (C7 Automation OS)

Read `BUILD.md` for the full design. These are the rules that keep the platform a platform.

## The three layers, never mixed

1. **Core** (`core/`): vertical-agnostic. The channel, brain, booking primitive, state store, config loader, handler. It never knows the name of a business or the quirks of a vertical.
2. **Vertical Pack** (`verticals/<name>/`): per vertical. Intents, entity schema, tool selection, resource model, message templates, prompt fragment, availability logic.
3. **Client Config** (`clients/<slug>.json`): per business. Name, location, hours, services or menu, prices (ZAR), policies, resources, channel number.

Business data never enters code. Vertical logic never enters a client config.

## Non-negotiables

- **One booking primitive** (resource + capacity + duration + party + startsAt + service). Do not add a parallel "reservation" model. Extend the primitive.
- **The model never invents availability.** It comes only from `check_availability`, which reads the pack's resource model and the backend adapter.
- **Re-validate every slot inside `create_booking`** before writing. Never trust the model's tool arguments.
- **Adding a vertical = a new folder under `verticals/`**, never edits to Core control flow. If Core must change, change it once for all verticals. If Phase 2 needs Core changes beyond adding a tool or a pack, the abstraction leaked. Fix the Core, do not fork it.
- **Timezone-aware everywhere** (`Africa/Johannesburg`). Store UTC, present local.
- **Money is ZAR.** No em dashes in user-facing copy.
- **Every external call wrapped, logged, with a clean customer-facing failure path.**
- **Secrets only in env.** Never commit `.env` or a live client config with a real token.

## Targets

- A new client on an existing pack: hours.
- A new pack: days.
- If it takes longer, the abstraction leaked. Fix Core once.

## Where things go

| You are adding | Put it in |
| --- | --- |
| A new business | `clients/<slug>.json` (copy `_template.json`) |
| A new vertical | `verticals/<name>/` (copy `verticals/service/`) |
| A new shared tool | `core/brain/tools.ts` + list it in the packs that use it |
| A new scheduled workflow | `n8n/` |
| A booking backend | `core/booking/` behind the adapter interface |
