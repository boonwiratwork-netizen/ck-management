-- Count rows whose saved difference missed that day's moves (18 Nov 2026).
--
-- A move recorded after the count was typed (transfer to/from another branch, return to the
-- kitchen, WIP batch) changed the balance on screen, but the saved balance and difference kept
-- the old figure (the sheet only rewrote rows when receipts/usage/opening changed). Found on
-- Thaniya, เส้นตรง โฮมเมด, 13 Nov: transfer of 40 to Shiro, saved difference −40, real 0.
-- The app is fixed (use-daily-stock-count.ts); this repairs the rows already saved.
--
-- Only rows that were COUNTED (physical_count set) and whose saved balance is exactly the
-- balance without that day's moves are touched: their difference becomes count − (balance + moves).
-- Rows not counted are left alone (their balance feeds the next day's opening).

-- ═══ STEP 1 · preview (reads only) ═══
with day_moves as (
  select branch_id, sku_id, adjustment_date, sum(quantity) as moves
  from stock_adjustments where branch_id is not null
  group by 1, 2, 3
), rows as (
  select c.id, b.branch_name, s.name, c.count_date, c.physical_count, c.calculated_balance, c.variance, m.moves,
         c.opening_balance + c.received_from_ck
           + c.received_external * (case when s.purchase_uom = s.usage_uom then 1 else coalesce(nullif(s.converter, 0), 1) end)
           - c.expected_usage - c.waste as base
  from daily_stock_counts c
  join day_moves m on m.branch_id = c.branch_id and m.sku_id = c.sku_id and m.adjustment_date = c.count_date
  join skus s on s.id = c.sku_id join branches b on b.id = c.branch_id
  where c.physical_count is not null and m.moves <> 0
)
select branch_name as สาขา, count_date as วันที่, name as ของ, round(moves, 1) as โอน_ปรับ,
       round(variance, 1) as ส่วนต่างเดิม, round(physical_count - (base + moves), 1) as ส่วนต่างใหม่
from rows
where abs(calculated_balance - base) < 0.5 and abs(calculated_balance - (base + moves)) >= 0.5
order by count_date, branch_name, name;

-- ═══ STEP 2 · apply (after the preview looks right) ═══
begin;
with day_moves as (
  select branch_id, sku_id, adjustment_date, sum(quantity) as moves
  from stock_adjustments where branch_id is not null
  group by 1, 2, 3
), rows as (
  select c.id, c.physical_count, c.calculated_balance, m.moves,
         c.opening_balance + c.received_from_ck
           + c.received_external * (case when s.purchase_uom = s.usage_uom then 1 else coalesce(nullif(s.converter, 0), 1) end)
           - c.expected_usage - c.waste as base
  from daily_stock_counts c
  join day_moves m on m.branch_id = c.branch_id and m.sku_id = c.sku_id and m.adjustment_date = c.count_date
  join skus s on s.id = c.sku_id
  where c.physical_count is not null and m.moves <> 0
)
update daily_stock_counts c
set calculated_balance = r.base + r.moves,
    variance = r.physical_count - (r.base + r.moves)
from rows r
where c.id = r.id and abs(r.calculated_balance - r.base) < 0.5 and abs(r.calculated_balance - (r.base + r.moves)) >= 0.5
returning c.count_date, c.variance;
commit;
