-- Transfer orders / production, 1 Nov 2026 — PART 2: the repair, one transaction.
-- Run AFTER supabase/migrations/20261101090000_transfer_order_integrity.sql and after looking at
-- the lists in 20261101_1_check.sql (A, A2, B, B2, D, E, I are what this changes). Run it as one
-- script (select all, Run), at a quiet time. Safe to run again: a second run finds nothing.

begin;

-- ▶ SWITCH for step I (add the missing RM/PK deduction to sent orders, list I in the check file):
--   'on' = do it now (default) · 'off' = leave it; run this file again later with 'on' (the other
--   steps then find nothing to do)
set local ck.repair_step_i = 'on';

-- The status guard lets this transaction alone take an order out of Cancelled / Declined (A2).
-- It needs a session with no app login (the SQL Editor), and ends with the transaction.
set local ck.repair = 'on';

-- A2. Cancelled / declined although the branch received them (the old cancel allowed it): back
--     to received. Their SM goes out of the kitchen again (it came back with the cancel); their
--     RM/PK rows were never removed. First an SM line with no amount typed gets its planned
--     amount, but only when the branch received that product from the order (B2): SM that
--     never left isn't charged to the kitchen.
update public.transfer_order_lines l
set actual_qty = l.planned_qty
from public.transfer_orders t
where t.id = l.to_id and t.status in ('Cancelled', 'Declined') and exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id)
  and l.sku_type = 'SM' and l.actual_qty <= 0 and l.planned_qty > 0
  and exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id and r.sku_id = l.sku_id and r.qty_received > 0);

with sent as (
  select l.to_id, l.sku_id, sum(case when l.actual_qty > 0 then l.actual_qty else l.planned_qty end) as sent
  from public.transfer_order_lines l group by 1, 2
), got as (
  select r.transfer_order_id as to_id, r.sku_id, sum(r.qty_received) as got
  from public.branch_receipts r where r.transfer_order_id is not null group by 1, 2
), back_to as (
  select t.id, case when bool_and(coalesce(g.got, 0) >= s.sent * 0.9 - 1e-9) filter (where s.sent > 0) is false then 'Partially Received' else 'Received' end as status
  from public.transfer_orders t
  join sent s on s.to_id = t.id
  left join got g on g.to_id = t.id and g.sku_id = s.sku_id
  where t.status in ('Cancelled', 'Declined') and exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id)
  group by t.id
)
update public.transfer_orders t set status = b.status from back_to b where t.id = b.id and t.status in ('Cancelled', 'Declined');

-- B. Still "Sent" though the branch received them: closed. The same SM fill first (B2): an
--    order that stops being "Sent" no longer counts a line with no amount at its planned amount,
--    so a product the branch received keeps it; one it didn't receive comes back to the kitchen.
update public.transfer_order_lines l
set actual_qty = l.planned_qty
from public.transfer_orders t
where t.id = l.to_id and t.status = 'Sent' and exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id)
  and l.sku_type = 'SM' and l.actual_qty <= 0 and l.planned_qty > 0
  and exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id and r.sku_id = l.sku_id and r.qty_received > 0);

with sent as (
  select l.to_id, l.sku_id, sum(case when l.actual_qty > 0 then l.actual_qty else l.planned_qty end) as sent
  from public.transfer_order_lines l group by 1, 2
), got as (
  select r.transfer_order_id as to_id, r.sku_id, sum(r.qty_received) as got
  from public.branch_receipts r where r.transfer_order_id is not null group by 1, 2
), closed as (
  select t.id, case when bool_and(coalesce(g.got, 0) >= s.sent * 0.9 - 1e-9) filter (where s.sent > 0) is false then 'Partially Received' else 'Received' end as status
  from public.transfer_orders t
  join sent s on s.to_id = t.id
  left join got g on g.to_id = t.id and g.sku_id = s.sku_id
  where t.status = 'Sent' and exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id)
  group by t.id
)
update public.transfer_orders t set status = c.status from closed c where t.id = c.id and t.status = 'Sent';

-- A. Cancelled / declined with nothing received: their RM/PK comes back, as their SM did.
--    (Orders the branch received are not touched here: A2 above made them received again.)
delete from public.stock_adjustments a
using public.transfer_orders t
where t.status in ('Cancelled', 'Declined') and a.branch_id is null and a.reason in ('Distribution: ' || t.to_number, 'Distribution: ' || t.id::text)
  and not exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id);

-- D. RM/PK deductions back on the day the order went out
update public.stock_adjustments a
set adjustment_date = (t.sent_at at time zone 'Asia/Bangkok')::date
from public.transfer_orders t
where a.branch_id is null and a.reason in ('Distribution: ' || t.to_number, 'Distribution: ' || t.id::text)
  and t.sent_at is not null and t.status in ('Sent', 'Received', 'Partially Received')
  and a.adjustment_date > (t.sent_at at time zone 'Asia/Bangkok')::date
  and a.created_at > t.sent_at + interval '10 minutes';

-- I. Sent orders whose RM/PK deduction differs from their lines: the difference, on the day each
--    was sent (sync_transfer_distribution, the app's own rule). After A2 and B, which change
--    which orders count as sent, and D, which fixes the day. Skipped when the switch is 'off'.
select current_setting('ck.repair_step_i') as step_i, count(*) as orders_synced
from (
  select public.sync_transfer_distribution(x.to_id)
  from (
    select distinct coalesce(l.to_id, d.to_id) as to_id
    from (select l.to_id, l.sku_id, l.sku_type as st, sum(l.actual_qty) as q from public.transfer_order_lines l where l.sku_type in ('RM', 'PK') and l.actual_qty > 0 group by 1, 2, 3) l
    full join (select t.id as to_id, a.sku_id, case when a.stock_type = 'PK' then 'PK' else 'RM' end as st, -sum(a.quantity) as q
               from public.stock_adjustments a join public.transfer_orders t on a.reason in ('Distribution: ' || t.to_number, 'Distribution: ' || t.id::text)
               where a.branch_id is null group by 1, 2, 3) d on d.to_id = l.to_id and d.sku_id = l.sku_id and d.st = l.st
    join public.transfer_orders t on t.id = coalesce(l.to_id, d.to_id)
    where t.status in ('Sent', 'Received', 'Partially Received') and abs(coalesce(l.q, 0) - coalesce(d.q, 0)) > 0.001
  ) x
  where current_setting('ck.repair_step_i') = 'on'
) y;

-- E. Take back the note-only production corrections (exactly as listed in E of the check file):
--    each record is left as it was deducted when it was saved
with cut as (
  select timestamptz '2026-10-27 07:57:27+07' as at, (public.ck_transfer_rules() ->> 'installed_at')::timestamptz as installed
), tagged as (
  select a.id, a.sku_id, a.quantity, a.reason, a.created_at,
    substring(a.reason from '\[rec ([0-9a-f-]{36})\]') as rec_id,
    substring(a.reason from '^Production(?: correction)?: ([0-9.]+) batches of ') as share
  from public.stock_adjustments a
  where a.branch_id is null and a.reason ~ '^Production(?: correction)?: [0-9.]+ batches of .*\[rec [0-9a-f-]{36}\]' and a.reason !~ ' legacy='
), base as (
  select t.rec_id, t.sku_id, sum(t.quantity) as qty from tagged t, cut where t.created_at < cut.at group by 1, 2
), last_share as (
  select distinct on (t.rec_id) t.rec_id, t.share from tagged t, cut where t.created_at < cut.at order by t.rec_id, t.created_at desc
), ratio as (
  select h.sm_sku_id, l.rm_sku_id as sku_id, sum(l.qty_per_batch / l.yield_percent) / nullif(sum(l.qty_per_batch), 0) as k
  from public.bom_headers h join public.bom_lines l on l.bom_header_id = h.id
  where coalesce(h.bom_mode, 'simple') <> 'multistep' and l.yield_percent > 0
  group by 1, 2
), note_only as (
  select c.id
  from tagged c
  cross join cut
  join public.production_records pr on pr.id::text = c.rec_id and pr.created_at < cut.at
  join last_share ls on ls.rec_id = c.rec_id and ls.share = c.share
  join base b on b.rec_id = c.rec_id and b.sku_id = c.sku_id
  join ratio r on r.sm_sku_id = pr.sm_sku_id and r.sku_id = c.sku_id
  where c.reason like 'Production correction: %'
    and c.created_at >= cut.at and c.created_at < cut.installed
    and r.k > 1
    and abs(c.quantity - b.qty * (r.k - 1)) <= 0.01 + 0.001 * abs(b.qty * (r.k - 1))
)
delete from public.stock_adjustments a using note_only n where a.id = n.id;

commit;
