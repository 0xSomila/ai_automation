-- Run after meridian-retention.sql. The job continues when the app host is offline.
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'c7-meridian-pilot-retention',
  '*/15 * * * *',
  'select private.expire_meridian_pilot()'
);
