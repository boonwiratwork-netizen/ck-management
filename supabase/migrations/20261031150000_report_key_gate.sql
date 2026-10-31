-- Locks the three LINE report Edge Functions (daily-sales-report,
-- daily-production-report, to-sent-report) behind a shared key. They run with
-- verify_jwt = false, so until now anyone with the URL could read branch sales /
-- CK stock value or trigger LINE pushes. Each function now rejects requests
-- unless header x-report-key equals its REPORT_KEY secret
-- (requireReportKey in supabase/functions/_shared/report-utils.ts).
--
-- This file makes the only legitimate callers — the two pg_cron jobs and the
-- notify_to_sent() trigger — send that header. The key lives in Supabase Vault
-- (secret name 'report_key') and is read at call time, so it never appears in
-- this file, in cron.job.command, or in the function source.
--
-- Rollout order (safe at every step — the old functions ignore the header):
--   1. Run this file in the SQL Editor.
--   2. Read the key:  select decrypted_secret from vault.decrypted_secrets where name = 'report_key';
--      and save it as the Edge Function secret REPORT_KEY (same value).
--   3. Redeploy the three functions.
--
-- Supersedes the header-less calls in 20260809093258_schedule_daily_reports.sql
-- and 20260809093321_notify_to_sent.sql.

-- ── 1. Vault key (generated once, random; never typed or committed) ─────────
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'report_key') then
    perform vault.create_secret(
      -- two v4 UUIDs = 244 random bits from Postgres' strong RNG, as 64 hex chars
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'report_key',
      'x-report-key sent to the LINE report Edge Functions; must equal their REPORT_KEY secret'
    );
  end if;
end;
$$;

-- ── 2. Cron jobs: replace the command only, keep the live schedule ──────────
-- alter_job (not cron.schedule) so a schedule changed directly in the
-- dashboard isn't reset to whatever the original migration said.
-- coalesce(..., ''): if the Vault secret is ever missing the call still goes
-- out and is rejected with 401, instead of erroring inside pg_net.

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'daily-production-report'),
  command := $cmd$
    select
      net.http_post(
        url := 'https://lyhhaeikbvhmjpyjhdbg.supabase.co/functions/v1/daily-production-report',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-report-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'report_key'), '')
        ),
        body := '{}'::jsonb
      );
  $cmd$
);

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'daily-sales-report'),
  command := $cmd$
    select
      net.http_post(
        url := 'https://lyhhaeikbvhmjpyjhdbg.supabase.co/functions/v1/daily-sales-report',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-report-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'report_key'), '')
        ),
        body := '{}'::jsonb
      );
  $cmd$
);

-- ── 3. TO-sent trigger function ──────────────────────────────────────────────
-- Same trigger (trg_notify_to_sent) — only the function body changes. The call
-- is wrapped so that a notification problem (e.g. Vault unreadable) can never
-- roll back the transfer order's status change to "Sent".

create or replace function public.notify_to_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'Sent' and (old.status is distinct from 'Sent') then
    begin
      perform
        net.http_post(
          url := 'https://lyhhaeikbvhmjpyjhdbg.supabase.co/functions/v1/to-sent-report',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-report-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'report_key'), '')
          ),
          body := jsonb_build_object('to_id', new.id)
        );
    exception when others then
      raise warning 'notify_to_sent: could not queue to-sent-report for TO %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
