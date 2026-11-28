-- Apply after schema.sql. Each appointment mutation and its alert commit together.
begin;

create table if not exists public.practitioner_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id text not null,
  recipient text not null,
  kind text not null check (kind in ('change', 'daily')),
  dedupe_key text unique,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '720 hours'),
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  lease_token uuid,
  locked_until timestamptz,
  sent_at timestamptz
);
create index if not exists practitioner_notifications_pending
  on public.practitioner_notifications(business_id, available_at, created_at) where sent_at is null;
alter table public.practitioner_notifications enable row level security;
revoke all on public.practitioner_notifications from public, anon, authenticated;
grant select on public.practitioner_notifications to service_role;

create or replace function public.queue_practitioner_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  settings jsonb;
  recipient text;
  action text;
  previous_start timestamptz;
begin
  if new.kind <> 'appointment' or new.starts_at is null then return new; end if;
  select config -> 'practitionerNotifications' into settings
    from public.businesses where slug = new.business_id;
  recipient := settings ->> 'whatsappPhone';
  if recipient is null or recipient !~ '^\+[1-9][0-9]{7,14}$' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'confirmed' then return new; end if;
    action := 'New booking';
  elsif old.status = 'confirmed' and new.status = 'cancelled' then
    action := 'Cancelled';
    previous_start := old.starts_at;
  elsif old.status = 'confirmed' and new.status = 'confirmed' and old.starts_at is distinct from new.starts_at then
    action := 'Rescheduled';
    previous_start := old.starts_at;
  else
    return new;
  end if;
  insert into public.practitioner_notifications (business_id, recipient, kind, payload)
    values (new.business_id, recipient, 'change', jsonb_build_object(
      'action', action, 'reference', new.reference, 'service', new.service,
      'bookingName', new.payload ->> 'bookingName',
      'startsAt', new.starts_at, 'previousStartsAt', previous_start,
      'durationMin', new.duration_min));
  return new;
end;
$$;
revoke all on function public.queue_practitioner_change() from public, anon, authenticated;
drop trigger if exists queue_practitioner_change on public.engagements;
create trigger queue_practitioner_change after insert or update on public.engagements
  for each row execute function public.queue_practitioner_change();

create or replace function public.enqueue_practitioner_daily(
  business_slug text, recipient_phone text, local_date text, expiry timestamptz, parts jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('practitioner-daily:' || business_slug || ':' || local_date, 0));
  if exists (select 1 from public.practitioner_notifications
    where business_id = business_slug and kind = 'daily' and payload ->> 'date' = local_date) then return; end if;
  insert into public.practitioner_notifications (business_id, recipient, kind, dedupe_key, expires_at, payload)
    select business_slug, recipient_phone, 'daily',
      'daily:' || business_slug || ':' || local_date || ':' || p.ordinality,
      expiry, p.value
    from jsonb_array_elements(parts) with ordinality as p(value, ordinality)
    on conflict (dedupe_key) do nothing;
end;
$$;

create or replace function public.claim_practitioner_notice(business_slug text)
returns setof public.practitioner_notifications language plpgsql security definer set search_path = '' as $$
begin
  -- Keep the pilot's 30-day collection retention for all queue data.
  delete from public.practitioner_notifications where created_at <= now() - interval '720 hours';
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('practitioner-send:' || business_slug, 0));
  if exists (select 1 from public.practitioner_notifications
    where business_id = business_slug and sent_at is null and locked_until > now()) then return; end if;
  return query
    update public.practitioner_notifications n
    set lease_token = gen_random_uuid(), locked_until = now() + interval '2 minutes', attempts = n.attempts + 1
    where n.id = (
      select candidate.id from public.practitioner_notifications candidate
      where candidate.business_id = business_slug and candidate.sent_at is null
        and candidate.available_at <= now() and candidate.expires_at > now()
        and (candidate.locked_until is null or candidate.locked_until <= now())
      order by candidate.created_at, candidate.id for update skip locked limit 1
    ) returning n.*;
end;
$$;

create or replace function public.finish_practitioner_notice(notice_id uuid, claim_token uuid, accepted boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.practitioner_notifications
  set sent_at = case when accepted then now() else null end,
      available_at = now() + make_interval(secs => least(900, 60 * attempts)),
      locked_until = null, lease_token = null
  where id = notice_id and lease_token = claim_token and sent_at is null;
  if not found then raise exception 'Notification claim no longer held'; end if;
end;
$$;

revoke all on function public.enqueue_practitioner_daily(text, text, text, timestamptz, jsonb),
  public.claim_practitioner_notice(text), public.finish_practitioner_notice(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.enqueue_practitioner_daily(text, text, text, timestamptz, jsonb),
  public.claim_practitioner_notice(text), public.finish_practitioner_notice(uuid, uuid, boolean)
  to service_role;
commit;
