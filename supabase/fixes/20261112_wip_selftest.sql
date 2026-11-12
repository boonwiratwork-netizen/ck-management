-- WIP self-test: run AFTER the migration 20261112120000_wip_items.sql, BEFORE go-live.
-- Everything happens inside one block that always ends with an error on purpose, so the
-- database rolls ALL of it back (nothing is kept). The error message IS the result:
--   "WIP TEST ผ่าน 9/9" = everything works; otherwise it names what failed.
do $$
declare
  v_wip uuid;
  v_branch uuid;
  v_id uuid := gen_random_uuid();
  v_a uuid; v_b uuid; v_bad uuid;
  v_n int; v_q numeric; v_p numeric;
  v_day date := current_date + 1;  -- a day no count has been sent for
  ok int := 0; total int := 0; fails text := '';
  procedure_ok boolean;
begin
  select id into v_wip from skus where sku_id = 'RM-0202';
  select id into v_branch from branches where status = 'Active' order by branch_name limit 1;
  select id into v_a from skus where sku_id = 'SM-0008';
  select id into v_b from skus where sku_id = 'SM-0005';
  select id into v_bad from skus where sku_id = 'RM-0027';
  -- What go-live does (rolled back at the end)
  update skus set type = 'WIP' where id = v_wip;
  insert into wip_inputs (wip_sku_id, sku_id) values (v_wip, v_a), (v_wip, v_b) on conflict do nothing;

  -- 1-3. A batch: 300 + 200 in, 500 out → 2 inputs out, the WIP in, a price
  perform save_wip_batch(v_id, v_branch, v_wip, v_day, 500, jsonb_build_array(jsonb_build_object('sku_id', v_a, 'qty', 300), jsonb_build_object('sku_id', v_b, 'qty', 200)), '');
  select count(*), sum(quantity) into v_n, v_q from stock_adjustments where branch_id = v_branch and reason like '%[wip ' || v_id || ']';
  total := total + 1; if v_n = 3 and v_q = 0 then ok := ok + 1; else fails := fails || ' [1 แถวสต๊อก ' || v_n || ' รวม ' || v_q || ']'; end if;
  select quantity into v_q from stock_adjustments where sku_id = v_wip and reason like '%[wip ' || v_id || ']';
  total := total + 1; if v_q = 500 then ok := ok + 1; else fails := fails || ' [2 ชาชูรวมเข้า ' || coalesce(v_q, 0) || ']'; end if;
  select price_per_usage_uom into v_p from prices where sku_id = v_wip and is_active and supplier_id = '45cd33bb-82b7-4865-be1e-3c88f085cc72';
  total := total + 1; if v_p is not null and v_p >= 0 then ok := ok + 1; else fails := fails || ' [3 ราคา WIP ไม่ถูกตั้ง]'; end if;

  -- 4-5. The same id again (an edit): replaces, never doubles
  perform save_wip_batch(v_id, v_branch, v_wip, v_day, 400, jsonb_build_array(jsonb_build_object('sku_id', v_a, 'qty', 400)), '');
  select count(*), sum(quantity) into v_n, v_q from stock_adjustments where branch_id = v_branch and reason like '%[wip ' || v_id || ']';
  total := total + 1; if v_n = 2 and v_q = 0 then ok := ok + 1; else fails := fails || ' [4 แก้แล้วแถว ' || v_n || ']'; end if;
  select count(*) into v_n from wip_batch_lines where batch_id = v_id;
  total := total + 1; if v_n = 1 then ok := ok + 1; else fails := fails || ' [5 บรรทัดหลังแก้ ' || v_n || ']'; end if;

  -- 6. Something not on the list is refused
  procedure_ok := false;
  begin
    perform save_wip_batch(gen_random_uuid(), v_branch, v_wip, v_day, 100, jsonb_build_array(jsonb_build_object('sku_id', v_bad, 'qty', 100)), '');
  exception when others then procedure_ok := true;
  end;
  total := total + 1; if procedure_ok then ok := ok + 1; else fails := fails || ' [6 รับของที่ไม่อยู่ในรายการ]'; end if;

  -- 7. A non-WIP item is refused
  procedure_ok := false;
  begin
    perform save_wip_batch(gen_random_uuid(), v_branch, v_a, v_day, 100, jsonb_build_array(jsonb_build_object('sku_id', v_b, 'qty', 100)), '');
  exception when others then procedure_ok := true;
  end;
  total := total + 1; if procedure_ok then ok := ok + 1; else fails := fails || ' [7 รับของที่ไม่ใช่ WIP]'; end if;

  -- 8-9. Delete: the moves and the batch go
  perform delete_wip_batch(v_id);
  select count(*) into v_n from stock_adjustments where reason like '%[wip ' || v_id || ']';
  total := total + 1; if v_n = 0 then ok := ok + 1; else fails := fails || ' [8 ลบแล้วเหลือแถว ' || v_n || ']'; end if;
  select count(*) into v_n from wip_batches where id = v_id;
  total := total + 1; if v_n = 0 then ok := ok + 1; else fails := fails || ' [9 ลบแล้วรอบยังอยู่]'; end if;

  raise exception 'WIP TEST ผ่าน %/% %(ยกเลิกทุกอย่างแล้ว ไม่มีอะไรเปลี่ยน)', ok, total, case when fails = '' then '' else 'ไม่ผ่าน:' || fails || ' ' end;
end $$;
