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
-- Only the four move reasons count as moves; other same-day adjustments (old fixes, June
-- "Transfer Form" rows) stay as they were in the saved balance. Run 18 Nov: 13 rows.

-- ═══ STEP 1 · preview (reads only) ═══
with adj as (
  select branch_id, sku_id, adjustment_date,
         sum(quantity) filter (where (reason like 'WIP: %' or reason like 'โอนให้สาขาอื่น%' or reason like 'รับโอนจากสาขาอื่น%' or reason like 'ส่งคืนครัวกลาง%')) as moves,
         coalesce(sum(quantity) filter (where not (reason like 'WIP: %' or reason like 'โอนให้สาขาอื่น%' or reason like 'รับโอนจากสาขาอื่น%' or reason like 'ส่งคืนครัวกลาง%')), 0) as other
  from stock_adjustments where branch_id is not null group by 1, 2, 3
), rows as (
  select c.id, b.branch_name, s.name, c.count_date, c.physical_count, c.calculated_balance, c.variance, a.moves, a.other,
         c.opening_balance + c.received_from_ck
           + c.received_external * (case when s.purchase_uom = s.usage_uom then 1 else coalesce(nullif(s.converter, 0), 1) end)
           - c.expected_usage - c.waste as base
  from daily_stock_counts c
  join adj a on a.branch_id = c.branch_id and a.sku_id = c.sku_id and a.adjustment_date = c.count_date
  join skus s on s.id = c.sku_id join branches b on b.id = c.branch_id
  where c.physical_count is not null and coalesce(a.moves, 0) <> 0
)
select r.branch_name as สาขา, r.count_date as วันที่, r.name as ของ,
       round(r.variance, 1) as ส่วนต่างเดิม, round(r.physical_count - (r.base + r.other + r.moves), 1) as ส่วนต่างใหม่
from rows r
where abs(r.calculated_balance - (r.base + r.other)) < 0.5 and abs(r.variance - (r.physical_count - (r.base + r.other + r.moves))) >= 0.5
order by 2, 1, 3;

-- ═══ STEP 2 · apply ═══
begin;
with adj as (
  select branch_id, sku_id, adjustment_date,
         sum(quantity) filter (where (reason like 'WIP: %' or reason like 'โอนให้สาขาอื่น%' or reason like 'รับโอนจากสาขาอื่น%' or reason like 'ส่งคืนครัวกลาง%')) as moves,
         coalesce(sum(quantity) filter (where not (reason like 'WIP: %' or reason like 'โอนให้สาขาอื่น%' or reason like 'รับโอนจากสาขาอื่น%' or reason like 'ส่งคืนครัวกลาง%')), 0) as other
  from stock_adjustments where branch_id is not null group by 1, 2, 3
), rows as (
  select c.id, b.branch_name, s.name, c.count_date, c.physical_count, c.calculated_balance, c.variance, a.moves, a.other,
         c.opening_balance + c.received_from_ck
           + c.received_external * (case when s.purchase_uom = s.usage_uom then 1 else coalesce(nullif(s.converter, 0), 1) end)
           - c.expected_usage - c.waste as base
  from daily_stock_counts c
  join adj a on a.branch_id = c.branch_id and a.sku_id = c.sku_id and a.adjustment_date = c.count_date
  join skus s on s.id = c.sku_id join branches b on b.id = c.branch_id
  where c.physical_count is not null and coalesce(a.moves, 0) <> 0
)
update daily_stock_counts c
set calculated_balance = r.base + r.other + r.moves,
    variance = r.physical_count - (r.base + r.other + r.moves)
from rows r
where c.id = r.id and abs(r.calculated_balance - (r.base + r.other)) < 0.5 and abs(r.variance - (r.physical_count - (r.base + r.other + r.moves))) >= 0.5
returning c.count_date, round(c.variance, 1) as ส่วนต่างใหม่;
commit;
