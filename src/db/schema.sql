-- C7 Automation OS schema. Shared across all verticals.
begin;

set local search_path = public;

create table if not exists businesses (
  slug text primary key,
  vertical text not null,
  config jsonb not null,
  created_at timestamptz default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  business_id text not null,
  wa_phone text not null,
  name text,
  last_seen timestamptz default now(),
  reactivated_at timestamptz,
  unique (business_id, wa_phone)
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  business_id text not null,
  customer_id uuid references customers(id),
  status text default 'open',
  updated_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id),
  role text not null,           -- user | assistant | tool
  content text not null,
  created_at timestamptz default now()
);

create table if not exists engagements (
  id uuid primary key default gen_random_uuid(),
  business_id text not null,
  customer_id uuid references customers(id),
  kind text not null,           -- appointment | reservation | order | lead
  service text,
  resource text,
  party int default 1,
  starts_at timestamptz,
  duration_min int,
  status text default 'confirmed',
  reference text unique,
  backend_event_id text,
  reminder_sent_at timestamptz,
  followup_sent_at timestamptz,
  waitlist_notified_at timestamptz,
  payload jsonb,
  created_at timestamptz default now()
);

create table if not exists processed_messages (  -- inbound dedupe (Meta re-delivers)
  provider_message_id text primary key,
  business_id text not null,
  processed_at timestamptz default now()
);

create table if not exists cron_runs (       -- lightweight observability for scheduled jobs
  id uuid primary key default gen_random_uuid(),
  job text not null,                          -- reminders | followup | reactivation | waitlist
  sent int default 0,
  skipped int default 0,
  failed int default 0,
  ran_at timestamptz default now()
);

create index if not exists idx_cron_runs_job on cron_runs(job, ran_at desc);
create index if not exists idx_messages_conversation on messages(conversation_id, created_at);
create index if not exists idx_engagements_business on engagements(business_id, starts_at);
create index if not exists idx_engagements_status on engagements(status);

-- Only the Core accesses these tables through the Data API.
alter table businesses enable row level security;
alter table customers enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table engagements enable row level security;
alter table processed_messages enable row level security;
alter table cron_runs enable row level security;

revoke all on table businesses, customers, conversations, messages, engagements,
  processed_messages, cron_runs from public, anon, authenticated;
grant select, insert, update on table businesses, customers, engagements to service_role;
grant select, insert on table conversations, messages, cron_runs to service_role;
grant insert on table processed_messages to service_role;

commit;
