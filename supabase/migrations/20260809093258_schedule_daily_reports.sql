-- Schedules the two cron-based LINE report Edge Functions via pg_cron + pg_net.
-- Times are in UTC; Bangkok is UTC+7.
--   daily-production-report -> 17:00 Bangkok = 10:00 UTC
--   daily-sales-report      -> 20:30 Bangkok = 13:30 UTC
--
-- Prerequisites (do these first, outside this file):
--   1. Deploy daily-sales-report and daily-production-report.
--   2. Add secrets: LINE_CHANNEL_ACCESS_TOKEN, LINE_GROUP_ID.
--   3. Enable the "pg_cron" and "pg_net" extensions via the Dashboard's
--      Database -> Extensions toggle (NOT via CREATE EXTENSION here —
--      pg_cron needs superuser-level setup that a plain SQL Editor
--      statement can fail or half-apply on Supabase's hosted platform).
--
-- No secret/service_role key needed in this file: both functions have
-- verify_jwt = false and (confirmed by a direct browser request) the
-- project's gateway doesn't require an apikey header for them either.

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
