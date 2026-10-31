-- Transfer orders / production, 1 Nov 2026 — PART 1: read only. Nothing here changes data.
-- The SQL Editor shows only the last result of a run: run one statement at a time (select it,
-- then Run). S counts the lists in one result (E, E2, F and G are run on their own).
--
-- Run order:
--   1. 0a and 0b (any time; done 1 Nov — results below).
--   2. Deploy the app.
--   3. supabase/migrations/20261101090000_transfer_order_integrity.sql (read its NOTICE lines:
--      the policies and triggers it found, and the policies it dropped / replaced).
--   4. 0a and 0b again: they should now look like the "after" notes below.
--   5. S, then the lists A … Z of this file.
--   6. supabase/fixes/20261101_2_repair.sql, then S again (A, A2, B, D, I at 0; E empty).
-- Kitchen stock is anchored on its last count: a fix changes today's balance only for products
-- whose last kitchen count is before the row's date.

-- 0a. Policies on the tables the fix touches. Live before the migration (1 Nov), not in the
--     repo: transfer_orders "Store Manager can decline transfer orders" and "Store manager
--     receive own TO" (UPDATE), stock_adjustments "Store Manager can insert stock_adjustments"
--     (role only), store managers' own-branch insert/update/delete on branch_receipts and
--     transfer_request_lines; no CK-manager update on transfer_request_lines.
--     After: the two transfer_orders store-manager policies are gone (receive / decline go
--     through functions) and "Store manager own sent TO (guarded)" is there (own branch, Sent:
--     an old app's direct update gets "update the app" from the guard), stock_adjustments has "Store manager insert own branch waste or fix"
--     instead of the role-only one, transfer_request_lines has "CK manager decline TRL".
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('transfer_orders', 'transfer_order_lines', 'branch_receipts', 'stock_adjustments', 'transfer_request_lines')
order by tablename, cmd, policyname;

-- 0b. Triggers on the same tables. Live before (1 Nov), all from the repo's migrations:
--     transfer_orders set_sent_at_transfer_orders (20261025200000), set_updated_at_transfer_orders
--     (20260312003651), trg_notify_to_sent (20260809093321 / 20261031150000), trg_validate_to_status
--     (20260312003651 / 20260411052141); nothing on the other four tables.
--     After: on transfer_orders also guard_transfer_order_status, guard_transfer_order_delete,
--     return_transfer_order_stock (set_sent_at, trg_validate_to_status and notify_to_sent
--     replaced by the migration's versions); transfer_order_lines guard_transfer_order_line_delete,
--     guard_transfer_order_line_qty; branch_receipts guard_transfer_receipt; stock_adjustments
--     guard_distribution_insert, guard_distribution_delete; transfer_request_lines
--     guard_request_line_kitchen_update.
select event_object_table as table_name, trigger_name, action_timing, string_agg(event_manipulation, ', ') as events
from information_schema.triggers
where event_object_schema = 'public' and event_object_table in ('transfer_orders', 'transfer_order_lines', 'branch_receipts', 'stock_adjustments', 'transfer_request_lines')
group by 1, 2, 3
order by 1, 2;

-- S. Summary: how many rows each list below has (fix = PART 2 changes them; review = by hand)
select * from (values
  ('A  fix: cancelled/declined, nothing received, RM/PK still out', (
    select count(*) from public.transfer_orders t join public.stock_adjustments a on a.branch_id is null and a.reason in ('Distribution: ' || t.to_number, 'Distribution: ' || t.id::text)
    where t.status in ('Cancelled', 'Declined') and not exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id))),
  ('A2 fix: cancelled/declined though the branch received them', (
    select count(*) from public.transfer_orders t where t.status in ('Cancelled', 'Declined') and exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id))),
  ('B  fix: still Sent though received', (
    select count(*) from public.transfer_orders t where t.status = 'Sent' and exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id))),
  ('C  review: a product received twice on one order', (
    select count(*) from (select r.transfer_order_id, r.sku_id from public.branch_receipts r where r.transfer_order_id is not null group by 1, 2
      having count(*) > 1 and max(r.created_at) - min(r.created_at) > interval '1 minute') x)),
  ('D  fix: RM/PK rows dated an edit day', (
    select count(*) from public.stock_adjustments a join public.transfer_orders t on a.reason in ('Distribution: ' || t.to_number, 'Distribution: ' || t.id::text)
    where a.branch_id is null and t.sent_at is not null and t.status in ('Sent', 'Received', 'Partially Received')
      and a.adjustment_date > (t.sent_at at time zone 'Asia/Bangkok')::date and a.created_at > t.sent_at + interval '10 minutes')),
  ('H  review: received, no receipt saved', (
    select count(*) from public.transfer_orders t where t.status in ('Received', 'Partially Received') and not exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id))),
  ('I  fix: sent orders whose RM/PK deduction differs from their lines', (
    select count(distinct coalesce(l.to_id, d.to_id)) from
      (select l.to_id, l.sku_id, l.sku_type as st, sum(l.actual_qty) as q from public.transfer_order_lines l where l.sku_type in ('RM', 'PK') and l.actual_qty > 0 group by 1, 2, 3) l
      full join (select t.id as to_id, a.sku_id, case when a.stock_type = 'PK' then 'PK' else 'RM' end as st, -sum(a.quantity) as q
                 from public.stock_adjustments a join public.transfer_orders t on a.reason in ('Distribution: ' || t.to_number, 'Distribution: ' || t.id::text)
                 where a.branch_id is null group by 1, 2, 3) d on d.to_id = l.to_id and d.sku_id = l.sku_id and d.st = l.st
      join public.transfer_orders t on t.id = coalesce(l.to_id, d.to_id)
    where t.status in ('Sent', 'Received', 'Partially Received') and abs(coalesce(l.q, 0) - coalesce(d.q, 0)) > 0.001)),
  ('Z  review: 0 typed on an order not received yet (reads as planned)', (
    select count(*) from public.transfer_order_lines l join public.transfer_orders t on t.id = l.to_id where t.status = 'Sent' and l.actual_qty <= 0 and l.planned_qty > 0))
) as s(list, rows);

-- A. FIX — cancelled / declined orders, nothing received, whose RM/PK is still taken out of
--    the kitchen (their SM already came back by the status): PART 2 removes these rows
select t.to_number, t.status, a.adjustment_date, s.sku_id as product, s.name, a.quantity, a.stock_type
from public.transfer_orders t
join public.stock_adjustments a on a.branch_id is null and a.reason in ('Distribution: ' || t.to_number, 'Distribution: ' || t.id::text)
join public.skus s on s.id = a.sku_id
where t.status in ('Cancelled', 'Declined')
  and not exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id)
order by t.to_number, s.sku_id;

-- A2. FIX — cancelled / declined although the branch received them (the old cancel allowed
--     it; their SM came back to the kitchen while the branch has the goods). PART 2 puts them
--     back to received; their RM/PK rows are still there and stay
with sent as (
  select l.to_id, l.sku_id, sum(case when l.actual_qty > 0 then l.actual_qty else l.planned_qty end) as sent
  from public.transfer_order_lines l group by 1, 2
), got as (
  select r.transfer_order_id as to_id, r.sku_id, sum(r.qty_received) as got
  from public.branch_receipts r where r.transfer_order_id is not null group by 1, 2
)
select t.to_number, b.branch_name, t.status as status_now, t.updated_at,
  case when bool_and(coalesce(g.got, 0) >= s.sent * 0.9 - 1e-9) filter (where s.sent > 0) is false then 'Partially Received' else 'Received' end as back_to
from public.transfer_orders t
join public.branches b on b.id = t.branch_id
join sent s on s.to_id = t.id
left join got g on g.to_id = t.id and g.sku_id = s.sku_id
where t.status in ('Cancelled', 'Declined') and exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id)
group by t.id, t.to_number, b.branch_name, t.status, t.updated_at
order by t.updated_at;

-- B. FIX — still "Sent" though the branch received them (a store manager's receive couldn't
--     close the order): the status PART 2 gives them (each product ≥ 90% of sent = Received)
with sent as (
  select l.to_id, l.sku_id, sum(case when l.actual_qty > 0 then l.actual_qty else l.planned_qty end) as sent
  from public.transfer_order_lines l group by 1, 2
), got as (
  select r.transfer_order_id as to_id, r.sku_id, sum(r.qty_received) as got
  from public.branch_receipts r where r.transfer_order_id is not null group by 1, 2
)
select t.to_number, b.branch_name, t.delivery_date,
  case when bool_and(coalesce(g.got, 0) >= s.sent * 0.9 - 1e-9) filter (where s.sent > 0) is false then 'Partially Received' else 'Received' end as new_status
from public.transfer_orders t
join public.branches b on b.id = t.branch_id
join sent s on s.to_id = t.id
left join got g on g.to_id = t.id and g.sku_id = s.sku_id
where t.status = 'Sent' and exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id)
group by t.id, t.to_number, b.branch_name, t.delivery_date
order by t.delivery_date;

-- B2. (with A2 and B) SM lines with no amount typed: while "Sent" the kitchen counted them at
--     the planned amount (to-line-qty.ts). PART 2 writes that amount in before the status
--     changes, but only where the branch received the product from the order; the others
--     count 0 after the repair (their SM comes back to the kitchen: it never left)
select t.to_number, t.status, s.sku_id as product, s.name, l.planned_qty, l.actual_qty,
  case when exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id and r.sku_id = l.sku_id and r.qty_received > 0)
       then 'keeps planned (branch received it)' else 'counts 0 (not received: SM back in the kitchen)' end as after_repair
from public.transfer_order_lines l
join public.transfer_orders t on t.id = l.to_id
join public.skus s on s.id = l.sku_id
where l.sku_type = 'SM' and l.actual_qty <= 0 and l.planned_qty > 0
  and t.status in ('Sent', 'Cancelled', 'Declined') and exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id)
order by t.to_number;

-- C. REVIEW — a product of one order saved by two separate receives (possible double)
select t.to_number, b.branch_name, s.sku_id as product, s.name, count(*) as saves, sum(r.qty_received) as received, min(r.created_at) as first_save, max(r.created_at) as last_save
from public.branch_receipts r
join public.transfer_orders t on t.id = r.transfer_order_id
join public.branches b on b.id = t.branch_id
join public.skus s on s.id = r.sku_id
group by t.to_number, b.branch_name, s.sku_id, s.name
having count(*) > 1 and max(r.created_at) - min(r.created_at) > interval '1 minute'
order by t.to_number;

-- D. FIX — RM/PK deductions an edit rewrote on the edit day instead of the day the order went
--    out (after a kitchen count in between, RM/PK read too low): PART 2 moves them back
select t.to_number, (t.sent_at at time zone 'Asia/Bangkok')::date as sent_day, a.adjustment_date as dated, a.created_at, s.sku_id as product, s.name, a.quantity
from public.stock_adjustments a
join public.transfer_orders t on a.reason in ('Distribution: ' || t.to_number, 'Distribution: ' || t.id::text)
join public.skus s on s.id = a.sku_id
where a.branch_id is null and t.sent_at is not null and t.status in ('Sent', 'Received', 'Partially Received')
  and a.adjustment_date > (t.sent_at at time zone 'Asia/Bangkok')::date
  and a.created_at > t.sent_at + interval '10 minutes'
order by t.to_number, s.sku_id;

-- E. FIX — production "corrections" written when only a note changed, on a record saved before
--    the bought-amount rule went live (27 Oct 2026 07:57 Bangkok): the old edit took the
--    trimming loss out a second time. Only rows that are exactly that: the record's batch share
--    unchanged, and the row = what the record had out × (bought ÷ trimmed − 1) by its recipe
--    lines' usable %. Anything else is in E2. Upper bound: when the migration first ran.
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
)
select c.id, pr.production_date, sm.name as made, pr.actual_output_g, s.name as ingredient, c.quantity, round((b.qty * (r.k - 1))::numeric, 3) as expected, c.created_at
from tagged c
cross join cut
join public.production_records pr on pr.id::text = c.rec_id and pr.created_at < cut.at
join last_share ls on ls.rec_id = c.rec_id and ls.share = c.share
join base b on b.rec_id = c.rec_id and b.sku_id = c.sku_id
join ratio r on r.sm_sku_id = pr.sm_sku_id and r.sku_id = c.sku_id
join public.skus sm on sm.id = pr.sm_sku_id
join public.skus s on s.id = c.sku_id
where c.reason like 'Production correction: %'
  and c.created_at >= cut.at and c.created_at < cut.installed
  and r.k > 1
  and abs(c.quantity - b.qty * (r.k - 1)) <= 0.01 + 0.001 * abs(b.qty * (r.k - 1))
order by pr.production_date, sm.name;

-- E2. REVIEW — every movement written since 27 Oct for records saved before it (E's rows
--     included, for comparison): output changes, day moves and records from before the
--     per-record tag carry part of the same loss, which needs the recipe at the time to size
select pr.production_date, sm.name as made, pr.actual_output_g, a.reason, s.name as ingredient, a.quantity, a.created_at
from public.stock_adjustments a
join public.production_records pr on a.reason like '%[rec ' || pr.id::text || ']%'
join public.skus sm on sm.id = pr.sm_sku_id
join public.skus s on s.id = a.sku_id
where a.branch_id is null and a.created_at >= timestamptz '2026-10-27 07:57:27+07' and pr.created_at < timestamptz '2026-10-27 07:57:27+07'
  and a.reason not like 'Production by-product%'
order by a.created_at;

-- F. REVIEW — kitchen goods at a branch with no order attached, for products whose two units
--    differ: stock reads them × the unit converter. Receipts of a deleted order look like this
--    (their link was emptied); so do goods booked as "ครัวกลาง (กรณีไม่มีใบโอน)"
select r.receipt_date, b.branch_name, s.sku_id as product, s.name, r.qty_received, r.uom, s.purchase_uom, s.usage_uom, s.converter, r.qty_received * s.converter as read_as, r.created_at
from public.branch_receipts r
join public.skus s on s.id = r.sku_id
join public.branches b on b.id = r.branch_id
where r.transfer_order_id is null and r.supplier_name = 'Central Kitchen' and s.purchase_uom <> s.usage_uom and coalesce(s.converter, 1) <> 1
order by r.receipt_date desc;

-- G. REVIEW — saved in the morning but dated the day before (a page left open overnight, or
--    back-dated on purpose: only people on site can tell)
select 'branch receipt' as kind, b.branch_name as place, r.receipt_date as dated, date_trunc('minute', r.created_at at time zone 'Asia/Bangkok') as saved_at, count(*) as rows
from public.branch_receipts r join public.branches b on b.id = r.branch_id
where r.receipt_date = (r.created_at at time zone 'Asia/Bangkok')::date - 1 and extract(hour from r.created_at at time zone 'Asia/Bangkok') between 5 and 11 and r.created_at > now() - interval '60 days'
group by 1, 2, 3, 4
union all
select 'kitchen bill', '', g.receipt_date, date_trunc('minute', g.created_at at time zone 'Asia/Bangkok'), count(*)
from public.goods_receipts g
where g.receipt_date = (g.created_at at time zone 'Asia/Bangkok')::date - 1 and extract(hour from g.created_at at time zone 'Asia/Bangkok') between 5 and 11 and g.created_at > now() - interval '60 days'
group by 1, 2, 3, 4
union all
select 'production', '', p.production_date, date_trunc('minute', p.created_at at time zone 'Asia/Bangkok'), count(*)
from public.production_records p
where p.production_date = (p.created_at at time zone 'Asia/Bangkok')::date - 1 and extract(hour from p.created_at at time zone 'Asia/Bangkok') between 5 and 11 and p.created_at > now() - interval '60 days'
group by 1, 2, 3, 4
order by saved_at desc;

-- H. REVIEW — marked received with no receipt at all (a receive that didn't finish, or receipts
--    deleted later). The branch's list shows those delivered in the last 14 days again, to
--    receive or decline, and the kitchen can cancel them. An older one can be reopened by hand:
--    update public.transfer_orders set status = 'Sent' where to_number = '...';
select t.to_number, b.branch_name, t.status, t.delivery_date, t.updated_at
from public.transfer_orders t join public.branches b on b.id = t.branch_id
where t.status in ('Received', 'Partially Received') and not exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id)
order by t.updated_at desc;

-- I. FIX — sent orders whose RM/PK deduction differs from their lines (an edit refused halfway,
--    a deduction that failed when sent): PART 2 adds the difference on the day each was sent
with l as (
  select l.to_id, l.sku_id, l.sku_type as stock_type, sum(l.actual_qty) as out_qty
  from public.transfer_order_lines l where l.sku_type in ('RM', 'PK') and l.actual_qty > 0 group by 1, 2, 3
), d as (
  select t.id as to_id, a.sku_id, case when a.stock_type = 'PK' then 'PK' else 'RM' end as stock_type, -sum(a.quantity) as out_qty
  from public.stock_adjustments a
  join public.transfer_orders t on a.reason in ('Distribution: ' || t.to_number, 'Distribution: ' || t.id::text)
  where a.branch_id is null
  group by 1, 2, 3
)
select t.to_number, t.status, s.sku_id as product, s.name, coalesce(l.out_qty, 0) as on_lines, coalesce(d.out_qty, 0) as taken_out, coalesce(l.out_qty, 0) - coalesce(d.out_qty, 0) as still_to_take
from l full join d on d.to_id = l.to_id and d.sku_id = l.sku_id and d.stock_type = l.stock_type
join public.transfer_orders t on t.id = coalesce(l.to_id, d.to_id)
join public.skus s on s.id = coalesce(l.sku_id, d.sku_id)
where t.status in ('Sent', 'Received', 'Partially Received') and abs(coalesce(l.out_qty, 0) - coalesce(d.out_qty, 0)) > 0.001
order by t.to_number, s.sku_id;

-- I2. (with I) List I per product: how many orders, sent between which days, and the total it
--     would take out of the kitchen (+) or give back (−), in the product's usage unit. Too big
--     to judge now? Set the switch at the top of the repair file to 'off' and run I later.
with l as (
  select l.to_id, l.sku_id, l.sku_type as stock_type, sum(l.actual_qty) as out_qty
  from public.transfer_order_lines l where l.sku_type in ('RM', 'PK') and l.actual_qty > 0 group by 1, 2, 3
), d as (
  select t.id as to_id, a.sku_id, case when a.stock_type = 'PK' then 'PK' else 'RM' end as stock_type, -sum(a.quantity) as out_qty
  from public.stock_adjustments a
  join public.transfer_orders t on a.reason in ('Distribution: ' || t.to_number, 'Distribution: ' || t.id::text)
  where a.branch_id is null
  group by 1, 2, 3
), diff as (
  select coalesce(l.to_id, d.to_id) as to_id, coalesce(l.sku_id, d.sku_id) as sku_id, coalesce(l.out_qty, 0) - coalesce(d.out_qty, 0) as still_to_take
  from l full join d on d.to_id = l.to_id and d.sku_id = l.sku_id and d.stock_type = l.stock_type
)
select s.sku_id as product, s.name, s.usage_uom as unit, count(distinct x.to_id) as orders,
  min(coalesce((t.sent_at at time zone 'Asia/Bangkok')::date, t.delivery_date)) as first_day,
  max(coalesce((t.sent_at at time zone 'Asia/Bangkok')::date, t.delivery_date)) as last_day,
  round(sum(x.still_to_take)::numeric, 2) as total_to_take
from diff x
join public.transfer_orders t on t.id = x.to_id
join public.skus s on s.id = x.sku_id
where t.status in ('Sent', 'Received', 'Partially Received') and abs(x.still_to_take) > 0.001
group by s.sku_id, s.name, s.usage_uom
order by abs(sum(x.still_to_take)) desc;

-- Z. REVIEW — 0 typed on a line of an order the branch hasn't received (before 1 Nov the app
--    kept the plan): the branch's receive screen (and the kitchen's SM) still read the planned
--    amount, while RM/PK took out nothing. Since 1 Nov a 0 also clears the plan ("not sent").
--    If it really wasn't sent: update public.transfer_order_lines set planned_qty = 0 where id = '...';
select l.id as line_id, t.to_number, b.branch_name, t.delivery_date, s.sku_id as product, s.name, l.sku_type, l.planned_qty, l.actual_qty
from public.transfer_order_lines l
join public.transfer_orders t on t.id = l.to_id
join public.branches b on b.id = t.branch_id
join public.skus s on s.id = l.sku_id
where t.status = 'Sent' and l.actual_qty <= 0 and l.planned_qty > 0
order by t.delivery_date, t.to_number;
