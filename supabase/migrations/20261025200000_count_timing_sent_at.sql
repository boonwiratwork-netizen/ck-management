-- Count day movements (kitchen stock count):
-- 1) stock_count_sessions.count_timing: did the count happen before or after that
--    day's movements? 'before' | 'after'; null = counts saved before this (old rule).
-- 2) transfer_orders.sent_at: when the kitchen pressed send. updated_at can't be
--    used — a branch receiving the order bumps it.
alter table public.stock_count_sessions add column if not exists count_timing text;
alter table public.transfer_orders add column if not exists sent_at timestamptz;

create or replace function public.set_transfer_order_sent_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'Sent' and old.status is distinct from 'Sent' and new.sent_at is null then
    new.sent_at := now();
  end if;
  return new;
end $$;

drop trigger if exists set_sent_at_transfer_orders on public.transfer_orders;
create trigger set_sent_at_transfer_orders
  before update on public.transfer_orders
  for each row execute function public.set_transfer_order_sent_at();

-- Orders already sent: the time their RM/PK stock was taken out, where there is one
update public.transfer_orders t
set sent_at = d.first_at
from (
  select substring(reason from 15) as to_number, min(created_at) as first_at
  from public.stock_adjustments
  where reason like 'Distribution: %'
  group by 1
) d
where t.sent_at is null and t.status <> 'Draft' and d.to_number = t.to_number;
