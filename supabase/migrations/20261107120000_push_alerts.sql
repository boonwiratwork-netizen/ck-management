-- Phone push alerts for management and kitchen managers (Bucci, 7 Nov 2026).
-- Web Push to the installed app; the LINE reports are untouched.
--
-- What this file makes (safe to run again: every column is added with
-- "add column if not exists", so a re-run on an older copy of a table adds what is new):
--   alert_settings         one row per rule + "_global": on/off, when (tier), thresholds, worsen step.
--                          The app's settings screen and the Edge Function alerts-run both read it.
--   push_subscriptions     each person's phones/computers that switched notifications on
--                          (https endpoints of the known push services only)
--   alert_recipient_prefs  per person, per rule: on/off (no row = on)
--   alert_cases            one row per case (stable key), open → acknowledged → closed
--   alert_deliveries       log: every push, hold and digest line, per person
--   alert_digests          each person's morning / close-of-day digest (the app's ล่าสุด list),
--                          plus one claim row per digest and day (running → done)
--   alert_run_lock         one row: a run holds it so two runs never overlap
--   functions: alert_register_device, alert_case_ack, alert_case_use_as_normal (people);
--              alerts_sales_daily, alerts_prices, alert_claim_digest, alert_try_lock,
--              alert_release_lock (alerts-run only, service role)
--   cron job "alerts-tick" every 15 minutes → alerts-run (x-report-key from Vault, like the reports)
--
-- Order (see src/lib/alerts/README.md "Deploy"):
--   1. Run this file in the SQL Editor.
--   2. Add Edge secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (REPORT_KEY is already there).
--   3. Deploy the function alerts-run.
-- Until step 3 the cron calls get a 404 and nothing happens.

-- Adds a constraint only if it isn't there yet (constraints have no "if not exists")
create or replace function pg_temp.add_constraint(p_table text, p_name text, p_def text)
returns void language plpgsql as $$
begin
  if not exists (select 1 from pg_constraint where conname = p_name and conrelid = ('public.' || p_table)::regclass) then
    execute format('alter table public.%I add constraint %I %s', p_table, p_name, p_def);
  end if;
end;
$$;

-- ── Settings ────────────────────────────────────────────────────────────────
create table if not exists public.alert_settings (rule text primary key);
alter table public.alert_settings add column if not exists enabled boolean not null default true;
alter table public.alert_settings add column if not exists tier text not null default 'morning';
alter table public.alert_settings add column if not exists thresholds jsonb not null default '{}'::jsonb;
alter table public.alert_settings add column if not exists worsen_step numeric;
alter table public.alert_settings add column if not exists worsen_mode text;
alter table public.alert_settings add column if not exists updated_at timestamptz not null default now();
alter table public.alert_settings add column if not exists updated_by uuid;
select pg_temp.add_constraint('alert_settings', 'alert_settings_tier', $c$check (tier in ('immediate', 'morning', 'evening', 'weekly', 'monthly'))$c$);
select pg_temp.add_constraint('alert_settings', 'alert_settings_worsen_mode', $c$check (worsen_mode in ('add', 'mult'))$c$);

-- Defaults — must equal DEFAULT_GLOBAL / DEFAULT_RULES in supabase/functions/_shared/alerts/config.ts
-- (src/lib/alerts/config.test.ts checks the JSON between the two markers). Existing rows are kept:
-- a setting changed in the app is never reset by running this file again.
insert into public.alert_settings (rule, enabled, tier, thresholds, worsen_step, worsen_mode)
select x.rule, x.enabled, x.tier, x.thresholds, x.worsen_step, x.worsen_mode
from jsonb_to_recordset(
-- ALERT_DEFAULTS_BEGIN
$json$[
 {"rule":"_global","enabled":true,"tier":"morning","thresholds":{"window_start":"08:00","window_end":"21:30","morning_at":"08:00","evening_at":"21:15","weekly_dow":1,"daily_cap":5,"dedupe_hours":24,"habit_days":4,"habit_window_days":7,"digest_catchup_minutes":120,"digest_push_lines":3,"case_retention_days":90,"vapid_public_key":""},"worsen_step":null,"worsen_mode":null},
 {"rule":"to_declined","enabled":true,"tier":"immediate","thresholds":{"lookback_hours":48},"worsen_step":null,"worsen_mode":null},
 {"rule":"to_short","enabled":true,"tier":"immediate","thresholds":{"short_pct":10,"lookback_hours":48},"worsen_step":null,"worsen_mode":null},
 {"rule":"price_rise_big","enabled":true,"tier":"immediate","thresholds":{"rise_pct":25,"lookback_days":7,"sku_types":["RM"]},"worsen_step":10,"worsen_mode":"add"},
 {"rule":"team_red","enabled":true,"tier":"morning","thresholds":{"period":"week"},"worsen_step":1,"worsen_mode":"add"},
 {"rule":"count_problem","enabled":true,"tier":"morning","thresholds":{"close_hour":23,"diff_baht":1000,"lookback_days":2},"worsen_step":2,"worsen_mode":"mult"},
 {"rule":"to_unreceived","enabled":true,"tier":"morning","thresholds":{"hours":24},"worsen_step":2,"worsen_mode":"add"},
 {"rule":"sales_missing","enabled":true,"tier":"morning","thresholds":{"lookback_days":2,"skip_if_no_count":true},"worsen_step":null,"worsen_mode":null},
 {"rule":"price_rise","enabled":true,"tier":"morning","thresholds":{"rise_pct":10,"lookback_days":7,"sku_types":["RM"]},"worsen_step":10,"worsen_mode":"add"},
 {"rule":"counted_early","enabled":true,"tier":"morning","thresholds":{"min_days":2,"window_days":7},"worsen_step":2,"worsen_mode":"add"},
 {"rule":"close_of_day","enabled":true,"tier":"evening","thresholds":{"sales_drop_pct":15},"worsen_step":null,"worsen_mode":null},
 {"rule":"weekly_scores","enabled":true,"tier":"weekly","thresholds":{},"worsen_step":null,"worsen_mode":null},
 {"rule":"weekly_cost","enabled":true,"tier":"weekly","thresholds":{"new_item_days":7},"worsen_step":null,"worsen_mode":null},
 {"rule":"month_close","enabled":true,"tier":"monthly","thresholds":{"max_days":10},"worsen_step":null,"worsen_mode":null}
]$json$::jsonb
-- ALERT_DEFAULTS_END
) as x(rule text, enabled boolean, tier text, thresholds jsonb, worsen_step numeric, worsen_mode text)
on conflict (rule) do nothing;

alter table public.alert_settings enable row level security;
drop policy if exists "Managers read alert settings" on public.alert_settings;
create policy "Managers read alert settings" on public.alert_settings for select to authenticated
  using (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role));
-- Only management changes the settings (no insert/delete: the rows come from this file)
drop policy if exists "Management updates alert settings" on public.alert_settings;
create policy "Management updates alert settings" on public.alert_settings for update to authenticated
  using (has_role(auth.uid(), 'management'::app_role))
  with check (has_role(auth.uid(), 'management'::app_role));

-- ── Devices ─────────────────────────────────────────────────────────────────
-- A push endpoint must be https on one of the browsers' push services: nothing else can be
-- stored, so the server never posts to an address someone typed in.
create or replace function public.alert_push_endpoint_ok(p_endpoint text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_endpoint ~ '^https://(fcm\.googleapis\.com|web\.push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)/', false);
$$;

create table if not exists public.push_subscriptions (id uuid primary key default gen_random_uuid());
alter table public.push_subscriptions add column if not exists user_id uuid not null references auth.users(id) on delete cascade;
alter table public.push_subscriptions add column if not exists endpoint text not null;
alter table public.push_subscriptions add column if not exists p256dh text not null;
alter table public.push_subscriptions add column if not exists auth text not null;
alter table public.push_subscriptions add column if not exists device_label text not null default '';
alter table public.push_subscriptions add column if not exists created_at timestamptz not null default now();
alter table public.push_subscriptions add column if not exists last_success_at timestamptz;
alter table public.push_subscriptions add column if not exists failure_count integer not null default 0;
select pg_temp.add_constraint('push_subscriptions', 'push_subscriptions_endpoint_key', 'unique (endpoint)');
select pg_temp.add_constraint('push_subscriptions', 'push_subscriptions_endpoint_ok', 'check (public.alert_push_endpoint_ok(endpoint))');
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "Own push subscriptions: read" on public.push_subscriptions;
create policy "Own push subscriptions: read" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "Own push subscriptions: add" on public.push_subscriptions;
create policy "Own push subscriptions: add" on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid() and public.alert_push_endpoint_ok(endpoint)
              and (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role)));
drop policy if exists "Own push subscriptions: change" on public.push_subscriptions;
create policy "Own push subscriptions: change" on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.alert_push_endpoint_ok(endpoint));
drop policy if exists "Own push subscriptions: remove" on public.push_subscriptions;
create policy "Own push subscriptions: remove" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- A phone handed to another person: its endpoint is re-registered under the new person.
-- Row security hides the old row (someone else's), so the upsert can't see it: this does
-- the hand-over, only ever to the person calling. created_at restarts (no burst of old news).
create or replace function public.alert_register_device(p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.alert_push_endpoint_ok(p_endpoint) then
    raise exception 'not a push service address' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, coalesce(p_label, ''))
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        device_label = excluded.device_label, failure_count = 0,
        created_at = case when push_subscriptions.user_id = auth.uid() then push_subscriptions.created_at else now() end;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.alert_register_device(text, text, text, text) from public, anon;
grant execute on function public.alert_register_device(text, text, text, text) to authenticated;

-- ── Per-person rule switches ────────────────────────────────────────────────
-- updated_at of a row switched back on = from when that rule's news is pushed (no burst)
create table if not exists public.alert_recipient_prefs (user_id uuid not null references auth.users(id) on delete cascade, rule text not null, primary key (user_id, rule));
alter table public.alert_recipient_prefs add column if not exists enabled boolean not null default true;
alter table public.alert_recipient_prefs add column if not exists updated_at timestamptz not null default now();
alter table public.alert_recipient_prefs enable row level security;
drop policy if exists "Own alert prefs" on public.alert_recipient_prefs;
create policy "Own alert prefs" on public.alert_recipient_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Cases ───────────────────────────────────────────────────────────────────
create table if not exists public.alert_cases (key text primary key);
alter table public.alert_cases add column if not exists rule text not null default '';
alter table public.alert_cases add column if not exists tier text not null default 'morning';
alter table public.alert_cases add column if not exists title text not null default '';
alter table public.alert_cases add column if not exists detail text not null default '';
alter table public.alert_cases add column if not exists severity text not null default 'medium';
alter table public.alert_cases add column if not exists status text not null default 'open';
alter table public.alert_cases add column if not exists scope jsonb not null default '{}'::jsonb;
alter table public.alert_cases add column if not exists link jsonb not null default '{}'::jsonb;
alter table public.alert_cases add column if not exists habit_key text;
alter table public.alert_cases add column if not exists habit_day date;
alter table public.alert_cases add column if not exists habit_label text;
alter table public.alert_cases add column if not exists opened_at timestamptz not null default now();
alter table public.alert_cases add column if not exists changed_at timestamptz not null default now();
alter table public.alert_cases add column if not exists last_seen_at timestamptz not null default now();
alter table public.alert_cases add column if not exists closed_at timestamptz;
alter table public.alert_cases add column if not exists last_value numeric not null default 0;
alter table public.alert_cases add column if not exists notified_value numeric not null default 0;
alter table public.alert_cases add column if not exists baseline numeric;
alter table public.alert_cases add column if not exists baseline_set_at timestamptz;
alter table public.alert_cases add column if not exists baseline_candidate numeric;
alter table public.alert_cases add column if not exists acknowledged_at timestamptz;
alter table public.alert_cases add column if not exists acknowledged_by uuid;
select pg_temp.add_constraint('alert_cases', 'alert_cases_severity', $c$check (severity in ('high', 'medium', 'low'))$c$);
select pg_temp.add_constraint('alert_cases', 'alert_cases_status', $c$check (status in ('open', 'acknowledged', 'closed'))$c$);
create index if not exists alert_cases_status on public.alert_cases (status, changed_at desc);
create index if not exists alert_cases_habit on public.alert_cases (habit_key, habit_day) where habit_key is not null;

alter table public.alert_cases enable row level security;
drop policy if exists "Managers read alert cases" on public.alert_cases;
create policy "Managers read alert cases" on public.alert_cases for select to authenticated
  using (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role));
-- No write policy: alerts-run writes with the service role; people use the two functions below

-- "รับทราบ": silent until it closes or gets worse. Returns the rows changed (0 = not open any more).
create or replace function public.alert_case_ack(p_key text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.alert_cases
     set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid()
   where key = p_key and status = 'open';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- "ใช้ราคานี้เป็นปกติ" (price cases): today's price becomes the price rises are measured from
-- (with when it was set); worsening is measured from zero again. The case stays acknowledged
-- while the rise lasts and closes when it leaves the look-back (the base goes with it).
create or replace function public.alert_case_use_as_normal(p_key text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.alert_cases
     set baseline = baseline_candidate, baseline_set_at = now(), notified_value = 0,
         status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid()
   where key = p_key and key like 'price\_rise:%' and baseline_candidate is not null and status <> 'closed';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.alert_case_ack(text) from public, anon;
revoke all on function public.alert_case_use_as_normal(text) from public, anon;
grant execute on function public.alert_case_ack(text) to authenticated;
grant execute on function public.alert_case_use_as_normal(text) to authenticated;

-- ── Log ─────────────────────────────────────────────────────────────────────
create table if not exists public.alert_deliveries (id uuid primary key default gen_random_uuid());
alter table public.alert_deliveries add column if not exists case_key text;
alter table public.alert_deliveries add column if not exists user_id uuid not null;
alter table public.alert_deliveries add column if not exists channel text not null;
alter table public.alert_deliveries add column if not exists sent_at timestamptz not null default now();
alter table public.alert_deliveries add column if not exists result text not null;
select pg_temp.add_constraint('alert_deliveries', 'alert_deliveries_channel', $c$check (channel in ('push', 'digest'))$c$);
select pg_temp.add_constraint('alert_deliveries', 'alert_deliveries_result', $c$check (result in ('sent', 'failed', 'held_window', 'held_cap', 'held_dedupe'))$c$);
create index if not exists alert_deliveries_user on public.alert_deliveries (user_id, sent_at desc);
alter table public.alert_deliveries enable row level security;
drop policy if exists "Own alert deliveries" on public.alert_deliveries;
create policy "Own alert deliveries" on public.alert_deliveries for select to authenticated using (user_id = auth.uid());

-- One row per person per digest; plus a claim row (user_id all zeros) per kind and day:
-- 'running' while a run sends it, 'done' after. A 'running' claim older than 20 minutes (the
-- run died) can be taken over, so a failed Monday digest (weekly part included) still goes out.
create table if not exists public.alert_digests (id uuid primary key default gen_random_uuid());
alter table public.alert_digests add column if not exists kind text not null;
alter table public.alert_digests add column if not exists for_day date not null;
alter table public.alert_digests add column if not exists user_id uuid not null;
alter table public.alert_digests add column if not exists title text not null default '';
alter table public.alert_digests add column if not exists body text not null default '';
alter table public.alert_digests add column if not exists lines jsonb not null default '[]'::jsonb;
alter table public.alert_digests add column if not exists pushed boolean not null default false;
alter table public.alert_digests add column if not exists status text not null default 'done';
alter table public.alert_digests add column if not exists started_at timestamptz;
alter table public.alert_digests add column if not exists created_at timestamptz not null default now();
select pg_temp.add_constraint('alert_digests', 'alert_digests_kind', $c$check (kind in ('morning', 'evening'))$c$);
select pg_temp.add_constraint('alert_digests', 'alert_digests_status', $c$check (status in ('running', 'done'))$c$);
select pg_temp.add_constraint('alert_digests', 'alert_digests_once', 'unique (kind, for_day, user_id)');
alter table public.alert_digests enable row level security;
drop policy if exists "Own alert digests" on public.alert_digests;
create policy "Own alert digests" on public.alert_digests for select to authenticated using (user_id = auth.uid());

-- Claim a digest for this run: true = this run sends it. Taken when nobody has it, when a
-- previous run's claim is still 'running' after p_stale_minutes, or with p_force.
create or replace function public.alert_claim_digest(p_kind text, p_day date, p_stale_minutes integer, p_force boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  insert into public.alert_digests (kind, for_day, user_id, status, started_at)
  values (p_kind, p_day, '00000000-0000-0000-0000-000000000000', 'running', now())
  on conflict (kind, for_day, user_id) do update
    set status = 'running', started_at = now()
    where p_force
       or (alert_digests.status = 'running' and alert_digests.started_at < now() - make_interval(mins => p_stale_minutes));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- ── One run at a time ───────────────────────────────────────────────────────
-- A lease row, not pg_try_advisory_lock: each PostgREST call may run on a different pooled
-- connection, so a session-level advisory lock taken in one call would outlive it on a
-- connection someone else then uses (or never be released). The lease expires by itself.
create table if not exists public.alert_run_lock (id integer primary key default 1);
alter table public.alert_run_lock add column if not exists holder uuid;
alter table public.alert_run_lock add column if not exists acquired_at timestamptz;
select pg_temp.add_constraint('alert_run_lock', 'alert_run_lock_one_row', 'check (id = 1)');
insert into public.alert_run_lock (id) values (1) on conflict (id) do nothing;
alter table public.alert_run_lock enable row level security;
-- No policies: the service role only

create or replace function public.alert_try_lock(p_holder uuid, p_stale_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.alert_run_lock set holder = p_holder, acquired_at = now()
   where id = 1 and (holder is null or acquired_at < now() - make_interval(secs => p_stale_seconds));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

create or replace function public.alert_release_lock(p_holder uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.alert_run_lock set holder = null, acquired_at = null where id = 1 and holder = p_holder;
$$;

-- ── Data for the rules (alerts-run only) ────────────────────────────────────
-- Sales per branch and day: one row instead of every sales line
create or replace function public.alerts_sales_daily(p_from date, p_to date)
returns table (branch_id uuid, sale_date date, first_created_at timestamptz, net_amount numeric)
language sql
stable
set search_path = public
as $$
  select s.branch_id, s.sale_date, min(s.created_at), coalesce(sum(s.net_amount), 0)
  from public.sales_entries s
  where s.sale_date between p_from and p_to
  group by s.branch_id, s.sale_date;
$$;

-- Prices: per item, the last price_history change before p_since ('before'), every change
-- since ('change'), and today's standard price = the newest active price row ('standard').
create or replace function public.alerts_prices(p_since timestamptz)
returns table (kind text, sku_id uuid, price numeric, valid_from timestamptz)
language sql
stable
set search_path = public
as $$
  select 'before', h.sku_id, h.price_per_usage_uom, h.valid_from
    from (select distinct on (sku_id) sku_id, price_per_usage_uom, valid_from
            from public.price_history where valid_from < p_since
           order by sku_id, valid_from desc, created_at desc) h
  union all
  select 'change', sku_id, price_per_usage_uom, valid_from from public.price_history where valid_from >= p_since
  union all
  select 'standard', p.sku_id, p.price_per_usage_uom, p.created_at
    from (select distinct on (sku_id) sku_id, price_per_usage_uom, created_at
            from public.prices where is_active
           order by sku_id, created_at desc, id) p;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.alerts_sales_daily(date, date)', 'public.alerts_prices(timestamptz)',
    'public.alert_claim_digest(text, date, integer, boolean)', 'public.alert_try_lock(uuid, integer)', 'public.alert_release_lock(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- ── Every 15 minutes ────────────────────────────────────────────────────────
-- One job: the function reads the digest times from alert_settings, so changing a time in
-- the app needs no change here (UTC never comes into it). Same Vault key as the reports
-- (20261031150000_report_key_gate.sql). cron.schedule with an existing name replaces it.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'alerts-tick',
  '*/15 * * * *',
  $cmd$
    select
      net.http_post(
        url := 'https://lyhhaeikbvhmjpyjhdbg.supabase.co/functions/v1/alerts-run',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-report-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'report_key'), '')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
  $cmd$
);
