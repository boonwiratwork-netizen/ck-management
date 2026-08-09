-- Schedules the two cron-based LINE report Edge Functions via pg_cron + pg_net.
-- Times are in UTC; Bangkok is UTC+7.
--   daily-production-report -> 17:00 Bangkok = 10:00 UTC
--   daily-sales-report      -> 20:30 Bangkok = 13:30 UTC
--
-- Prerequisites (do these first, outside this file):
--   1. Deploy daily-sales-report and daily-production-report.
--   2. Add secrets: LINE_CHANNEL_ACCESS_TOKEN, LINE_GROUP_ID.
--   3. Replace <SERVICE_ROLE_KEY> below with this project's actual
--      service_role key (Settings -> API) before running — never commit
--      the real key to the repo.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select
  cron.schedule(
    'daily-production-report',
    '0 10 * * *',
    $$
    select
      net.http_post(
        url := 'https://lyhhaeikbvhmjpyjhdbg.supabase.co/functions/v1/daily-production-report',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
        ),
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
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
        ),
        body := '{}'::jsonb
      );
    $$
  );
