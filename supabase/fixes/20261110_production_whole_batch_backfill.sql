-- Production since 25 Oct 2026 took raw material by the exact share of the output
-- (33 kg from a 30 kg recipe = 1.1 batches). The rule is now whole batches
-- (1 batch), a small batch under half a recipe by its share. This gives back what
-- each record took over its whole batches (or takes the shortfall for 27 kg = 0.9 → 1).
--
-- Run AFTER the migration 20261110120000_production_deduct_batches.sql.
-- STEP 1 (preview) reads only. STEP 2 writes, in one transaction.
--
-- How a correction is worked out, per record and ingredient:
--   share_then = the batches in the record's latest reason ("Production: 1.05 batches of …"),
--                exact as output ÷ (batch_size × yield) when that rounds to the same number
--   share_now  = under 0.5 → share_then, else round(share_then)
--   correction = what the record has out now × (share_now ÷ share_then − 1)
-- Only ingredients (rows taken out) are scaled; by-products stay as weighed.
-- Each correction is dated on the record's day and tagged [rec <id>], so later edits
-- and deletes in the app count it. Corrections dated before an ingredient's latest
-- count change nothing in its balance (the count already reset it).

-- ═══ STEP 1 · preview ═══════════════════════════════════════════════
with rec as (
  select pr.id, pr.sm_sku_id, pr.production_date, pr.actual_output_g,
         h.bom_mode, h.batch_size * h.yield_percent as per_batch
  from production_records pr
  -- One recipe per product (the app takes the first)
  join lateral (select bh.bom_mode, bh.batch_size, bh.yield_percent from bom_headers bh where bh.sm_sku_id = pr.sm_sku_id order by bh.id limit 1) h on true
  where pr.production_date >= '2026-10-25' and pr.deduct_batches is null and pr.actual_output_g > 0
),
moves as (
  select r.id as rec_id, sa.sku_id, sa.stock_type, sum(sa.quantity) as qty_out,
         bool_or(sa.reason like '%legacy=%') as legacy
  from rec r
  join stock_adjustments sa on sa.reason like '%[rec ' || r.id || ']%'
  group by r.id, sa.sku_id, sa.stock_type
),
-- The share in the record's latest reason ("Production: 1.05 batches of …"), for multi-step recipes
last_share as (
  select distinct on (r.id) r.id as rec_id, substring(sa.reason from ': ([0-9]+(\.[0-9]+)?) batches')::numeric as reason_share
  from rec r
  join stock_adjustments sa on sa.reason like '%[rec ' || r.id || ']%' and sa.reason ~ ': [0-9]+(\.[0-9]+)? batches'
  order by r.id, sa.created_at desc
),
share as (
  -- What it took: the share in its latest reason (2 decimals); the exact output share when
  -- that is the same number (a record saved by the new app before this ran says "1 batches")
  select r.*, case when r.bom_mode <> 'multistep' and r.per_batch > 0 and abs(r.actual_output_g / r.per_batch - ls.reason_share) < 0.006
                   then r.actual_output_g / r.per_batch else ls.reason_share end as share_then
  from rec r join last_share ls on ls.rec_id = r.id
),
plan as (
  select s.*, case when s.share_then < 0.5 then s.share_then else round(s.share_then) end as share_now
  from share s where s.share_then > 0
),
fix as (
  select p.id as rec_id, p.production_date, p.sm_sku_id, p.actual_output_g, p.share_then, p.share_now,
         m.sku_id, m.stock_type, m.qty_out,
         round(m.qty_out * (p.share_now / p.share_then - 1), 3) as correction
  from plan p join moves m on m.rec_id = p.id
  where not m.legacy and m.qty_out < 0 and abs(p.share_now - p.share_then) > 0.0001
)
select k.sku_id as รหัส, k.name as วัตถุดิบ, f.stock_type as ชนิด,
       count(distinct f.rec_id) as บันทึกผลิต,
       round(sum(f.qty_out)) as ตัดไปแล้ว,
       round(sum(f.correction)) as คืนให้_บวก_หรือตัดเพิ่ม_ลบ,
       (select max(sa2.adjustment_date) from stock_adjustments sa2
         where sa2.sku_id = f.sku_id and sa2.adjustment_date >= '2026-11-09'
           and sa2.reason not like 'Production%' and sa2.reason not like 'Distribution%' and sa2.reason not like '%Stock Count%') as แก้มือล่าสุด
from fix f join skus k on k.id = f.sku_id
group by k.sku_id, k.name, f.stock_type, f.sku_id
order by abs(sum(f.correction)) desc;


-- ═══ STEP 2 · apply (run after the preview looks right) ══════════════
begin;

create temp table _whole_batch_fix on commit drop as
with rec as (
  select pr.id, pr.sm_sku_id, pr.production_date, pr.actual_output_g,
         h.bom_mode, h.batch_size * h.yield_percent as per_batch
  from production_records pr
  -- One recipe per product (the app takes the first)
  join lateral (select bh.bom_mode, bh.batch_size, bh.yield_percent from bom_headers bh where bh.sm_sku_id = pr.sm_sku_id order by bh.id limit 1) h on true
  where pr.production_date >= '2026-10-25' and pr.deduct_batches is null and pr.actual_output_g > 0
),
moves as (
  select r.id as rec_id, sa.sku_id, sa.stock_type, sum(sa.quantity) as qty_out,
         bool_or(sa.reason like '%legacy=%') as legacy
  from rec r
  join stock_adjustments sa on sa.reason like '%[rec ' || r.id || ']%'
  group by r.id, sa.sku_id, sa.stock_type
),
-- The share in the record's latest reason ("Production: 1.05 batches of …"), for multi-step recipes
last_share as (
  select distinct on (r.id) r.id as rec_id, substring(sa.reason from ': ([0-9]+(\.[0-9]+)?) batches')::numeric as reason_share
  from rec r
  join stock_adjustments sa on sa.reason like '%[rec ' || r.id || ']%' and sa.reason ~ ': [0-9]+(\.[0-9]+)? batches'
  order by r.id, sa.created_at desc
),
share as (
  -- What it took: the share in its latest reason (2 decimals); the exact output share when
  -- that is the same number (a record saved by the new app before this ran says "1 batches")
  select r.*, case when r.bom_mode <> 'multistep' and r.per_batch > 0 and abs(r.actual_output_g / r.per_batch - ls.reason_share) < 0.006
                   then r.actual_output_g / r.per_batch else ls.reason_share end as share_then
  from rec r join last_share ls on ls.rec_id = r.id
)
select s.id as rec_id, s.production_date, s.sm_sku_id, s.share_then,
       case when s.share_then < 0.5 then s.share_then else round(s.share_then) end as share_now,
       m.sku_id, m.stock_type, m.qty_out, m.legacy
from share s join moves m on m.rec_id = s.id
where s.share_then > 0;

insert into stock_adjustments (sku_id, adjustment_date, quantity, reason, stock_type)
select f.sku_id, f.production_date,
       round(f.qty_out * (f.share_now / f.share_then - 1), 3),
       'Production correction: ' || f.share_now || ' batches of ' || f.sm_sku_id || ' (whole-batch rule, was ' || round(f.share_then, 2) || ') [rec ' || f.rec_id || ']',
       f.stock_type
from _whole_batch_fix f
where not f.legacy and f.qty_out < 0 and abs(f.share_now - f.share_then) > 0.0001
  and abs(f.qty_out * (f.share_now / f.share_then - 1)) >= 0.001;

-- Every record checked gets the batches it now stands at (so the app doesn't re-scale it)
update production_records pr set deduct_batches = x.share_now
from (select distinct rec_id, share_now from _whole_batch_fix where not legacy) x
where pr.id = x.rec_id;

-- Check: how many corrections went in, and the records' counts
select count(*) as แถวแก้สต๊อก from stock_adjustments where reason like '%(whole-batch rule, was %';
select count(*) as บันทึกที่ตั้งจำนวนชุดแล้ว from production_records where production_date >= '2026-10-25' and deduct_batches is not null;

commit;
