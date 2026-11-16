begin;

create schema if not exists private;
create table if not exists private.meridian_calendar_cleanup (
  event_id text primary key,
  queued_at timestamptz not null default now()
);
alter table private.meridian_calendar_cleanup enable row level security;

-- Keep only opaque calendar IDs for retrying provider cleanup after expiry.
create or replace function private.expire_meridian_pilot()
returns void language plpgsql set search_path = '' as $$
declare
  cutoff timestamptz := now() - interval '720 hours';
begin
  with expired as (
    delete from public.engagements
    where business_id = 'meridian' and created_at <= cutoff
    returning backend_event_id
  )
  insert into private.meridian_calendar_cleanup(event_id)
  select backend_event_id from expired
  where backend_event_id is not null and backend_event_id not like 'mem-%'
  on conflict do nothing;

  delete from public.messages m
  using public.conversations c
  where m.conversation_id = c.id and c.business_id = 'meridian' and m.created_at <= cutoff;

  delete from public.conversations c
  where c.business_id = 'meridian' and c.updated_at <= cutoff
    and not exists (select 1 from public.messages m where m.conversation_id = c.id)
    and not exists (select 1 from public.customers u where u.id = c.customer_id and u.last_seen > cutoff);

  delete from public.customers c
  where c.business_id = 'meridian' and c.last_seen <= cutoff
    and not exists (select 1 from public.conversations v where v.customer_id = c.id)
    and not exists (select 1 from public.engagements e where e.customer_id = c.id);

  delete from public.processed_messages
  where business_id = 'meridian' and processed_at <= cutoff;
end;
$$;

create or replace function public.meridian_calendar_cleanup_batch()
returns table(event_id text) language sql security definer set search_path = '' as $$
  select q.event_id from private.meridian_calendar_cleanup q
  order by q.queued_at, q.event_id limit 100;
$$;

create or replace function public.finish_meridian_calendar_cleanup(completed_event_id text)
returns void language sql security definer set search_path = '' as $$
  delete from private.meridian_calendar_cleanup where event_id = completed_event_id;
$$;

revoke all on function private.expire_meridian_pilot() from public;
revoke all on function public.meridian_calendar_cleanup_batch(),
  public.finish_meridian_calendar_cleanup(text) from public, anon, authenticated;
grant execute on function public.meridian_calendar_cleanup_batch(),
  public.finish_meridian_calendar_cleanup(text) to service_role;

commit;
