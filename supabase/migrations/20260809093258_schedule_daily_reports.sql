-- Schedules the two cron-based LINE report Edge Functions via pg_cron + pg_net.
-- Times are in UTC; Bangkok is UTC+7.
--   daily-production-report -> 17:00 Bangkok = 10:00 UTC
--   daily-sales-report      -> 20:30 Bangkok = 13:30 UTC
--
-- Prerequisites (do these first, outside this file):
--   1. Deploy daily-sales-report and daily-production-report.
--   2. Add secrets: LINE_CHANNEL_ACCESS_TOKEN, LINE_GROUP_ID.
--
-- No secret/service_role key needed in this file: both functions have
-- verify_jwt = false and (confirmed by a direct browser request) the
-- project's gateway doesn't require an apikey header for them either.

-- NOTE (2026-10-31): the call below is superseded by 20261031150000_report_key_gate.sql,
-- which adds the required x-report-key header. Don't re-run this file on its own.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select
  cron.schedule(
    'daily-production-report',
    '0 10 * * *',
    $$
    select
      net.http_post(
        url := 'https://lyhhaeikbvhmjpyjhdbg.supabase.co/functions/v1/daily-production-report',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      );
    $$
  );

select
  cron.schedule(
    'daily-sales-report',
    '30 13 * * *',
    $$
    select
      net.http_post(
        url := 'https://lyhhaeikbvhmjpyjhdbg.supabase.co/functions/v1/daily-sales-report',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      );
    $$
  );
