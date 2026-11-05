-- อ่านอย่างเดียว: ประวัติน้ำมันราเมนเหลืองในครัว (ผลิต / นับ / ส่ง / ปรับยอด) 90 วันล่าสุด
with s as (select id, sku_id, name from public.skus where name like '%น้ำมันราเมนเหลือง%')
select 'ผลิต' as kind, pr.production_date::text as day, pr.actual_output_g as qty, pr.batches_produced::text as detail, pr.created_at
from public.production_records pr join s on s.id = pr.sm_sku_id
where pr.production_date >= current_date - 90
union all
select 'นับครัว', ss.count_date::text, l.physical_qty, 'ระบบ ' || l.system_qty || ' · ' || ss.status || coalesce(' · ลบแล้ว', case when ss.deleted_at is null then '' end), ss.created_at
from public.stock_count_lines l join public.stock_count_sessions ss on ss.id = l.session_id join s on s.id = l.sku_id
where ss.count_date >= current_date - 90 and l.physical_qty is not null
union all
select 'ส่งสาขา', t.delivery_date::text, -tl.actual_qty, t.to_number || ' · ' || t.status || ' · ล็อต ' || coalesce((select sum(x.packs)::text from public.transfer_order_lot_lines x where x.to_line_id = tl.id), '0') || ' แพ็ค', t.created_at
from public.transfer_order_lines tl join public.transfer_orders t on t.id = tl.to_id join s on s.id = tl.sku_id
where t.delivery_date >= current_date - 90 and tl.actual_qty > 0
union all
select 'ปรับยอด', a.adjustment_date::text, a.quantity, a.reason, a.created_at
from public.stock_adjustments a join s on s.id = a.sku_id
where a.branch_id is null and a.adjustment_date >= current_date - 90 and a.reason not like 'Distribution:%'
order by 2 desc, 5 desc;
