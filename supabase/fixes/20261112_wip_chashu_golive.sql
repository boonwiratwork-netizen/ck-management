-- WIP go-live: ชาชูรวม (RM-0202) becomes a WIP the branches make from chashu trimmings.
-- Run AFTER the app is published and the migration 20261112120000_wip_items.sql is run.
-- STEP 1 reads only. STEP 2 writes, in one transaction, and must run on the same day as
-- the branches start recording batches (the count that night resets the chashu balances).
--
--   1. ชาชูรวม: type RM → WIP, code RM-0202 → WIP-0001 (same item: sales and counts stay linked)
--   2. what may go into it: the 5 chashu (SM-0005 … SM-0009)
--   3. those 5 chashu in every menu recipe: yield → 100% (trimmings no longer hide in the
--      yield: usable ones go into ชาชูรวม, the rest is waste), effective amount and cost
--      per serving rewritten with it (the app reads the stored effective amount)

-- ═══ STEP 1 · preview ═══════════════════════════════════════════════
-- Before go-live: RM-0202 should have no open kitchen requests / transfers and no kitchen stock
select 'ใบโอน/ใบขอเบิกที่ยังค้าง' as เช็ค, count(*) as จำนวน
from transfer_order_lines l join transfer_orders o on o.id = l.transfer_order_id
where l.sku_id = (select id from skus where sku_id = 'RM-0202') and o.status in ('Draft', 'Sent');
select 'ชาชูรวม' as เรื่อง, s.sku_id as รหัส, s.name as ชื่อ, s.type as ประเภทตอนนี้, null::numeric as yield_ตอนนี้, null::numeric as ตัดต่อจาน_ตอนนี้, null::numeric as ตัดต่อจาน_ใหม่
from skus s where s.sku_id = 'RM-0202'
union all
select m.menu_code || ' ' || m.menu_name, k.sku_id, k.name, coalesce(b.branch_id::text, 'ทุกสาขา'), b.yield_pct, round(b.effective_qty, 2), b.qty_per_serving
from menu_bom b join menus m on m.id = b.menu_id join skus k on k.id = b.sku_id
where k.sku_id in ('SM-0005', 'SM-0006', 'SM-0007', 'SM-0008', 'SM-0009') and coalesce(b.yield_pct, 100) <> 100
order by 1, 2;

-- ═══ STEP 2 · apply ═════════════════════════════════════════════════
begin;

-- 1. ชาชูรวม → WIP-0001 (stops if WIP-0001 is taken or RM-0202 is missing)
do $$
begin
  if exists (select 1 from skus where sku_id = 'WIP-0001') then raise exception 'WIP-0001 มีอยู่แล้ว'; end if;
  if not exists (select 1 from skus where sku_id = 'RM-0202') then raise exception 'ไม่พบ RM-0202'; end if;
end $$;
update skus set type = 'WIP', sku_id = 'WIP-0001', status = 'Active' where sku_id = 'RM-0202';
-- Its old purchase price (if any) goes: a WIP's price comes from its batches. Until the first
-- batch, it starts at the average price per gram of the 5 chashu (not ฿0 on menus and food cost)
update prices set is_active = false where sku_id = (select id from skus where sku_id = 'WIP-0001') and is_active;
insert into prices (sku_id, supplier_id, price_per_purchase_uom, price_per_usage_uom, vat, is_active, effective_date, note)
select w.id, '45cd33bb-82b7-4865-be1e-3c88f085cc72', 0, avg(p.price_per_usage_uom), false, true, current_date, 'WIP: ราคาเริ่มต้น = เฉลี่ยชาชู 5 ชนิด จนกว่าจะทำรอบแรก'
from skus w, skus k
join lateral (select pr.price_per_usage_uom from prices pr where pr.sku_id = k.id and pr.is_active order by pr.effective_date desc, pr.created_at desc limit 1) p on true
where w.sku_id = 'WIP-0001' and k.sku_id in ('SM-0005', 'SM-0006', 'SM-0007', 'SM-0008', 'SM-0009') and p.price_per_usage_uom > 0
group by w.id;

-- 2. What may go in
insert into wip_inputs (wip_sku_id, sku_id)
select w.id, k.id from skus w, skus k
where w.sku_id = 'WIP-0001' and k.sku_id in ('SM-0005', 'SM-0006', 'SM-0007', 'SM-0008', 'SM-0009')
on conflict (wip_sku_id, sku_id) do nothing;

-- 3. The 5 chashu: yield 100% in every menu recipe (delivery amounts follow the same yield)
update menu_bom b
set yield_pct = 100,
    effective_qty = b.qty_per_serving,
    cost_per_serving = b.qty_per_serving * coalesce((select p.price_per_usage_uom from prices p where p.sku_id = b.sku_id and p.is_active order by p.effective_date desc, p.created_at desc limit 1), 0)
from skus k
where k.id = b.sku_id and k.sku_id in ('SM-0005', 'SM-0006', 'SM-0007', 'SM-0008', 'SM-0009') and coalesce(b.yield_pct, 100) <> 100;

-- Check
select s.sku_id, s.name, s.type, s.status,
       (select count(*) from wip_inputs w where w.wip_sku_id = s.id) as ของที่ใส่ได้,
       (select round(p.price_per_usage_uom, 4) from prices p where p.sku_id = s.id and p.is_active limit 1) as ราคาเริ่มต้น_ต่อกรัม
from skus s where s.sku_id = 'WIP-0001';
select k.sku_id, count(*) as แถวในสูตร, min(b.yield_pct) as yield_ต่ำสุด, max(b.yield_pct) as yield_สูงสุด
from menu_bom b join skus k on k.id = b.sku_id
where k.sku_id in ('SM-0005', 'SM-0006', 'SM-0007', 'SM-0008', 'SM-0009')
group by k.sku_id order by 1;

commit;
