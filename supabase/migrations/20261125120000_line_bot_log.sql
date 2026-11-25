-- The LINE cost bot's log (25 Nov 2026): photos sent to the group (so "@bot check this
-- picture" can find one), questions and answers (what it remembers for follow-ups) and errors.
-- Written and read only by the line-bot Edge Function (service role): no one else.
create table if not exists public.line_bot_log (
  id uuid primary key default gen_random_uuid(),
  group_id text not null,
  kind text not null check (kind in ('image', 'question', 'answer', 'error')),
  user_id text,
  message_id text,
  text text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists line_bot_log_group_time on public.line_bot_log (group_id, kind, created_at desc);
alter table public.line_bot_log enable row level security;
revoke all on public.line_bot_log from anon, authenticated;
