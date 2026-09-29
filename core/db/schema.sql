-- C7 Automation OS: shared Supabase (Postgres) schema.
-- Vertical differences live in businesses.vertical, engagements.kind, and JSON
-- columns. The relational shape never changes per vertical. See BUILD.md section 8.

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  vertical text not null,            -- practitioner | restaurant | salon | service
  config jsonb not null,             -- the client config
  created_at timestamptz default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id),
  wa_phone text not null,
  name text,
  last_seen timestamptz default now(),
  unique (business_id, wa_phone)
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id),
  customer_id uuid references customers(id),
  status text default 'open',
  updated_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id),
  role text not null,                -- user | assistant | tool
  content text not null,
  created_at timestamptz default now()
);

create table if not exists engagements (   -- appointments AND reservations
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

create table if not exists processed_messages (   -- inbound dedupe (Meta re-delivers)
  provider_message_id text primary key,
  business_id uuid references businesses(id),
  processed_at timestamptz default now()
);

-- Helpful indexes for the scheduled workflows (reminders, follow-up, reactivation).
create index if not exists idx_engagements_business_starts
  on engagements (business_id, starts_at);
create index if not exists idx_engagements_status
  on engagements (status);
create index if not exists idx_conversations_business
  on conversations (business_id, status);
