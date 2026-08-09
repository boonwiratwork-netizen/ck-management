-- Fires the to-sent-report Edge Function the instant a transfer_orders row's status
-- changes to "Sent" — works no matter which code path performs the update (frontend
-- sendTO, a future bulk-send tool, admin fix, etc.), unlike a frontend-side fetch call
-- that could fail silently if the tab closes right after the status write.
--
-- Prerequisites (do these first, outside this file):
--   1. Deploy to-sent-report.
--   2. Add secrets: LINE_CHANNEL_ACCESS_TOKEN, LINE_GROUP_ID.
--   3. Enable the "pg_net" extension via the Dashboard's Database ->
--      Extensions toggle (skip if already enabled for the other
--      report's cron migration).
--
-- No secret/service_role key needed in this file: to-sent-report has
-- verify_jwt = false and (confirmed by a direct browser request) the
-- project's gateway doesn't require an apikey header for it either.

create or replace function public.notify_to_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'Sent' and (old.status is distinct from 'Sent') then
    perform
      net.http_post(
        url := 'https://lyhhaeikbvhmjpyjhdbg.supabase.co/functions/v1/to-sent-report',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('to_id', new.id)
      );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_to_sent on public.transfer_orders;

create trigger trg_notify_to_sent
after update on public.transfer_orders
for each row
execute function public.notify_to_sent();
