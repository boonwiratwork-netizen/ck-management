-- อ่านอย่างเดียว: รายการ A / A2 / C จาก 20261101_1_check.sql รวมเป็นผลเดียว
select 'A' as list, t.to_number, t.status, b.branch_name, a.adjustment_date::text as day,
  s.sku_id || ' ' || s.name as product, a.quantity::text as qty, a.stock_type as note
from public.transfer_orders t
join public.branches b on b.id = t.branch_id
join public.stock_adjustments a on a.branch_id is null and a.reason in ('Distribution: ' || t.to_number, 'Distribution: ' || t.id::text)
join public.skus s on s.id = a.sku_id
where t.status in ('Cancelled', 'Declined')
  and not exists (select 1 from public.branch_receipts r where r.transfer_order_id = t.id)
union all
select 'A2', t.to_number, t.status, b.branch_name, (t.updated_at at time zone 'Asia/Bangkok')::text,
  string_agg(distinct s.sku_id || ' ' || s.name, ', '), sum(r.qty_received)::text, 'สาขารับของแล้ว ' || count(r.*) || ' แถว'
from public.transfer_orders t
join public.branches b on b.id = t.branch_id
join public.branch_receipts r on r.transfer_order_id = t.id
join public.skus s on s.id = r.sku_id
where t.status in ('Cancelled', 'Declined')
group by t.id, t.to_number, t.status, b.branch_name, t.updated_at
union all
select 'C', t.to_number, t.status, b.branch_name,
  (min(r.created_at) at time zone 'Asia/Bangkok')::text || ' → ' || (max(r.created_at) at time zone 'Asia/Bangkok')::text,
  s.sku_id || ' ' || s.name, string_agg(r.qty_received::text, ' + ' order by r.created_at), count(*) || ' ครั้ง'
from public.branch_receipts r
join public.transfer_orders t on t.id = r.transfer_order_id
join public.branches b on b.id = t.branch_id
join public.skus s on s.id = r.sku_id
group by t.to_number, t.status, b.branch_name, s.sku_id, s.name
having count(*) > 1 and max(r.created_at) - min(r.created_at) > interval '1 minute'
order by 1, 2;
