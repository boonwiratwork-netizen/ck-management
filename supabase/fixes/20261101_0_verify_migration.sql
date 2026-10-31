-- ตรวจหลัง migration: ทุกแถวควรเป็น OK
with expect(kind, tbl, name, should_exist) as (values
  ('policy','transfer_orders','Store Manager can decline transfer orders', false),
  ('policy','transfer_orders','Store manager receive own TO', false),
  ('policy','transfer_orders','Store manager own sent TO (guarded)', true),
  ('policy','stock_adjustments','Store Manager can insert stock_adjustments', false),
  ('policy','stock_adjustments','Store manager insert own branch waste or fix', true),
  ('policy','transfer_request_lines','CK manager decline TRL', true),
  ('trigger','transfer_orders','guard_transfer_order_status', true),
  ('trigger','transfer_orders','guard_transfer_order_delete', true),
  ('trigger','transfer_orders','return_transfer_order_stock', true),
  ('trigger','transfer_order_lines','guard_transfer_order_line_delete', true),
  ('trigger','transfer_order_lines','guard_transfer_order_line_qty', true),
  ('trigger','branch_receipts','guard_transfer_receipt', true),
  ('trigger','stock_adjustments','guard_distribution_insert', true),
  ('trigger','stock_adjustments','guard_distribution_delete', true),
  ('trigger','transfer_request_lines','guard_request_line_kitchen_update', true),
  ('function','-','receive_transfer_order', true),
  ('function','-','decline_transfer_order', true),
  ('function','-','move_branch_stock', true)
)
select e.kind, e.tbl, e.name,
  case when (case e.kind
      when 'policy' then exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=e.tbl and p.policyname=e.name)
      when 'trigger' then exists(select 1 from information_schema.triggers t where t.event_object_schema='public' and t.event_object_table=e.tbl and t.trigger_name=e.name)
      else exists(select 1 from pg_proc f join pg_namespace n on n.oid=f.pronamespace where n.nspname='public' and f.proname=e.name) end) = e.should_exist
    then 'OK' else 'ผิด' end as result
from expect e order by result desc, e.kind, e.tbl;
