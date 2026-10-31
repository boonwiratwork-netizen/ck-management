-- Transfer orders keep stock right however they are changed (1 Nov 2026).
--
-- What this adds (the app has the same rules in lib/transfer-stock.ts):
--  0. A report of the live policies on the five tables involved (NOTICE lines), with a
--     WARNING for any other update policy on transfer_orders, so nothing is widened unseen.
--  1. A receipt keeps its transfer order: deleting an order the branch had received set
--     branch_receipts.transfer_order_id to empty, so the receipt read as a supplier's
--     (× unit converter) while the order's stock went back to the kitchen as well.
--  2. Only an unsent (Draft) or cancelled order can be deleted, and its lines with it.
--  3. Status only moves on. A new order starts as Draft and a Draft only becomes Sent or
--     Cancelled; nothing comes back from Cancelled or Declined; an order the branch has receipts
--     for stays received. "Received" with no receipt saved is a receive that didn't finish: it
--     still waits. A store manager (if a live policy lets one update orders at all) changes only
--     the status and decline reason of a waiting order.
--  4. A send put back to Draft clears sent_at: the next send dates the order again.
--  5. Cancelled / declined: the order's RM/PK "Distribution:" rows go in the same step (its SM
--     comes back by the status), also when a branch declines.
--  6. Distribution rows are written only by the kitchen, only for a sent order, and removed
--     only for one that isn't sent any more.
--  7. Quantities on a sent order whose RM/PK is out change only through
--     save_sent_transfer_order, which moves lines and deduction together.
--  8. No update policy for store managers: they receive and decline through the functions in
--     10, which check the branch themselves. (Only management / CK manager could ever update
--     transfer_orders, so a store manager's receive saved the receipts but left the order
--     "Sent", offered again, and a decline did nothing; the functions fix that.)
--  9. Kitchen goods on an order are received only through receive_transfer_order (the order
--     locked, still waiting, receipts saved once with the status), into the order's branch.
-- 10. The functions the app calls (one transaction each): receive_transfer_order (refuses more
--     than 3× what was sent: a typing slip), decline_transfer_order, save_sent_transfer_order
--     (a line set to 0 = not sent), sync_transfer_distribution, and ck_transfer_rules (version +
--     when this was first run).
-- 11. The "TO sent" LINE message goes out on a real send only (Draft → Sent).
--
-- Order: the app update goes live first, then this file. An older copy of the app still
-- open on a tablet is then refused cleanly before it saves anything (a receive, or a change of
-- quantities on a sent order) with a message to update; its send, cancel and decline still work.
-- Safe to run more than once.

-- ── 0. What is there now ─────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select tablename, policyname, cmd, array_to_string(roles, ',') as roles, coalesce(qual, '-') as qual, coalesce(with_check, '-') as with_check
    from pg_policies
    where schemaname = 'public' and tablename in ('transfer_orders', 'transfer_order_lines', 'branch_receipts', 'stock_adjustments', 'transfer_request_lines')
    order by tablename, cmd, policyname
  loop
    raise notice 'policy % | % | % | % | using: % | check: %', r.tablename, r.policyname, r.cmd, r.roles, r.qual, r.with_check;
  end loop;
  for r in
    select policyname, cmd, coalesce(qual, 'true') as qual
    from pg_policies
    where schemaname = 'public' and tablename = 'transfer_orders' and cmd in ('UPDATE', 'ALL')
      and policyname not in ('Management full update TO', 'CK manager full update TO')
  loop
    raise warning 'transfer_orders has another update policy "%" (%): %. It is left as it is (store managers'' changes through it are still limited by guard_transfer_order_status); the app no longer needs it. Check it is meant.', r.policyname, r.cmd, r.qual;
  end loop;
end $$;

-- ── 1. Receipts keep their order ─────────────────────────────────────────────
alter table public.branch_receipts drop constraint if exists branch_receipts_transfer_order_id_fkey;
alter table public.branch_receipts
  add constraint branch_receipts_transfer_order_id_fkey
  foreign key (transfer_order_id) references public.transfer_orders(id) on delete restrict;

-- ── 2. Deleting: unsent or cancelled orders only ─────────────────────────────
create or replace function public.guard_transfer_order_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status not in ('Draft', 'Cancelled') then
    raise exception 'ลบใบโอน % ไม่ได้ (สถานะ %): ใบที่ส่งแล้วให้ยกเลิกแทน', old.to_number, old.status using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists guard_transfer_order_delete on public.transfer_orders;
create trigger guard_transfer_order_delete before delete on public.transfer_orders
  for each row execute function public.guard_transfer_order_delete();

create or replace function public.guard_transfer_order_line_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select t.status into v_status from public.transfer_orders t where t.id = old.to_id;
  -- Not found: the order itself is being deleted (checked above) and its lines go with it
  if found and v_status not in ('Draft', 'Cancelled') then
    raise exception 'ลบรายการของใบโอนที่ส่งแล้วไม่ได้ (สถานะ %): แก้จำนวนแทน', v_status using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists guard_transfer_order_line_delete on public.transfer_order_lines;
create trigger guard_transfer_order_line_delete before delete on public.transfer_order_lines
  for each row execute function public.guard_transfer_order_line_delete();

-- ── 3. Status moves (and what a store manager may change) ────────────────────
create or replace function public.guard_transfer_order_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_branch_only boolean := v_uid is not null and has_role(v_uid, 'store_manager'::app_role)
    and not (has_role(v_uid, 'management'::app_role) or has_role(v_uid, 'ck_manager'::app_role));
  v_received boolean;
begin
  -- The SQL editor's repair (supabase/fixes/20261101_2_repair.sql) sets ck.repair for its own transaction
  if v_uid is null and current_setting('ck.repair', true) = 'on' then
    return new;
  end if;
  -- A new order starts as an unsent draft (the send and the receive are steps of their own)
  if tg_op = 'INSERT' then
    if v_uid is not null and new.status is distinct from 'Draft' then
      raise exception 'ใบโอนใหม่ต้องเริ่มเป็นใบร่าง (สถานะ %)', new.status using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- A store manager changes the status only (and the reason when declining); tr_id may only
  -- empty (deleting a request does that by itself). Runs before the triggers that set sent_at
  -- and updated_at (their names sort after this one), so those don't count as changes here.
  if v_branch_only and ((to_jsonb(new) - array['status', 'decline_reason', 'tr_id']) is distinct from (to_jsonb(old) - array['status', 'decline_reason', 'tr_id'])
      or (new.tr_id is distinct from old.tr_id and new.tr_id is not null)) then
    raise exception 'สาขาเปลี่ยนได้เฉพาะสถานะรับ/ปฏิเสธของใบโอน' using errcode = 'P0001';
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;
  if old.status in ('Cancelled', 'Declined') then
    raise exception 'ใบโอน % ถูก%แล้ว เปลี่ยนสถานะไม่ได้', old.to_number, case old.status when 'Cancelled' then 'ยกเลิก' else 'ปฏิเสธ' end using errcode = 'P0001';
  end if;
  -- A draft is sent (or thrown away): it never becomes received or declined on its own
  if old.status = 'Draft' and new.status not in ('Sent', 'Cancelled') then
    raise exception 'ใบร่าง % ต้องส่งก่อน (เปลี่ยนเป็น % ไม่ได้)', old.to_number, new.status using errcode = 'P0001';
  end if;
  v_received := exists (select 1 from public.branch_receipts r where r.transfer_order_id = old.id);
  -- Once the branch has the goods the order stays received (one still "Sent" may be closed)
  if v_received and new.status not in ('Received', 'Partially Received') then
    raise exception 'สาขารับของใบโอน % แล้ว เปลี่ยนเป็น % ไม่ได้: แก้ใบที่ส่งแล้วแทน', old.to_number, new.status using errcode = 'P0001';
  end if;
  -- A store manager moves only an order waiting at the branch: received, declined, or back to Sent
  if v_branch_only and not (old.status in ('Sent', 'Received', 'Partially Received') and new.status in ('Sent', 'Received', 'Partially Received', 'Declined')) then
    raise exception 'สาขาเปลี่ยนสถานะใบโอนนี้ไม่ได้' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists guard_transfer_order_status on public.transfer_orders;
create trigger guard_transfer_order_status before insert or update on public.transfer_orders
  for each row execute function public.guard_transfer_order_status();

-- ── 4. sent_at: set on a send, cleared when the send is put back to Draft ────
create or replace function public.set_transfer_order_sent_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'Sent' and old.status is distinct from 'Sent' and new.sent_at is null then
    new.sent_at := now();
  end if;
  if new.status = 'Draft' and old.status is distinct from 'Draft' then
    new.sent_at := null;
  end if;
  return new;
end $$;
drop trigger if exists set_sent_at_transfer_orders on public.transfer_orders;
create trigger set_sent_at_transfer_orders before update on public.transfer_orders
  for each row execute function public.set_transfer_order_sent_at();

-- ── 5. Cancelled / declined: the kitchen's RM/PK comes back ─────────────────
create or replace function public.return_transfer_order_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Guarded above: an order reaches these only with nothing received
  if old.status in ('Sent', 'Received', 'Partially Received') and new.status in ('Cancelled', 'Declined', 'Draft') then
    -- Tagged with the order's number; with its id when the number couldn't be read (Mar 2026)
    delete from public.stock_adjustments a
    where a.branch_id is null and a.reason in ('Distribution: ' || new.to_number, 'Distribution: ' || new.id::text);
  end if;
  return new;
end $$;
drop trigger if exists return_transfer_order_stock on public.transfer_orders;
create trigger return_transfer_order_stock after update of status on public.transfer_orders
  for each row execute function public.return_transfer_order_stock();

-- ── 6. Distribution rows follow their order ──────────────────────────────────
create or replace function public.guard_distribution_rows()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_reason text;
  v_branch uuid;
  v_key text;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_reason := old.reason;
    v_branch := old.branch_id;
  else
    v_reason := new.reason;
    v_branch := new.branch_id;
  end if;
  if v_branch is null and v_reason like 'Distribution: %' then
    v_key := substring(v_reason from 15);
    select t.status into v_status from public.transfer_orders t where t.to_number = v_key;
    if not found then
      select t.status into v_status from public.transfer_orders t where t.id::text = v_key;
    end if;
    if tg_op = 'INSERT' then
      if v_uid is not null and not (has_role(v_uid, 'management'::app_role) or has_role(v_uid, 'ck_manager'::app_role)) then
        raise exception 'สต๊อกที่ส่งให้สาขาบันทึกได้จากครัวกลางเท่านั้น' using errcode = 'P0001';
      end if;
      if v_status is null or v_status not in ('Sent', 'Received', 'Partially Received') then
        raise exception 'ใบโอน % ไม่ได้ส่งอยู่ (%) หักสต๊อกครัวให้ไม่ได้', v_key, coalesce(v_status, 'ไม่พบใบ') using errcode = 'P0001';
      end if;
    elsif v_status in ('Sent', 'Received', 'Partially Received') then
      raise exception 'สต๊อกที่หักไปกับใบโอน % ลบไม่ได้ขณะใบยังส่งอยู่: แก้ใบหรือยกเลิกใบแทน', v_key using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
drop trigger if exists guard_distribution_insert on public.stock_adjustments;
create trigger guard_distribution_insert before insert on public.stock_adjustments
  for each row execute function public.guard_distribution_rows();
drop trigger if exists guard_distribution_delete on public.stock_adjustments;
create trigger guard_distribution_delete before delete on public.stock_adjustments
  for each row execute function public.guard_distribution_rows();

-- ── 7. Quantities on a sent order move with its deduction ────────────────────
create or replace function public.guard_transfer_order_line_qty()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_number text;
begin
  if (new.actual_qty, new.planned_qty, new.sku_id, new.to_id) is not distinct from (old.actual_qty, old.planned_qty, old.sku_id, old.to_id) then
    return new; -- a note, a pack count
  end if;
  if auth.uid() is null or current_setting('ck.edit_to', true) = old.to_id::text then
    return new; -- the SQL editor, or save_sent_transfer_order
  end if;
  select t.status, t.to_number into v_status, v_number from public.transfer_orders t where t.id = old.to_id;
  -- While sending, the lines are saved before the order's RM/PK goes out: still allowed
  if v_status in ('Sent', 'Received', 'Partially Received') and exists (
      select 1 from public.stock_adjustments a where a.branch_id is null and a.reason in ('Distribution: ' || v_number, 'Distribution: ' || old.to_id::text)) then
    raise exception 'แก้จำนวนในใบโอน % ที่ส่งแล้ว ได้จากแอปเวอร์ชันล่าสุดเท่านั้น: อัปเดตแอปแล้วลองใหม่ (ยังไม่ได้บันทึกอะไร)', v_number using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists guard_transfer_order_line_qty on public.transfer_order_lines;
create trigger guard_transfer_order_line_qty before update on public.transfer_order_lines
  for each row execute function public.guard_transfer_order_line_qty();

-- ── 8. No store-manager update policy: the functions in 10 do it ─────────────
-- (An earlier draft of this file created one; dropped if a run made it.)
drop policy if exists "Store manager receive own TO" on public.transfer_orders;

-- ── 9. Kitchen goods on an order: through receive_transfer_order, into its branch ──
create or replace function public.guard_transfer_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_branch uuid;
  v_number text;
begin
  if tg_op = 'UPDATE' then
    if new.transfer_order_id is not distinct from old.transfer_order_id and new.branch_id is not distinct from old.branch_id then
      return new; -- quantity, price or note
    end if;
    -- Unlinking turned kitchen goods into a supplier's (× unit converter): not from the app
    if auth.uid() is not null and (old.transfer_order_id is not null or new.transfer_order_id is not null) then
      raise exception 'เปลี่ยนใบโอนหรือสาขาของรายการรับของไม่ได้ ลบแล้วรับใหม่แทน' using errcode = 'P0001';
    end if;
  end if;
  if new.transfer_order_id is null then
    return new;
  end if;
  select t.branch_id, t.to_number into v_branch, v_number from public.transfer_orders t where t.id = new.transfer_order_id;
  if not found then
    return new; -- the foreign key reports a missing order
  end if;
  if new.branch_id is distinct from v_branch then
    raise exception 'ใบโอน % ส่งให้อีกสาขา รับเข้าสาขานี้ไม่ได้', v_number using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null and current_setting('ck.receive_to', true) is distinct from new.transfer_order_id::text then
    raise exception 'รับของจากใบโอน % ได้จากแอปเวอร์ชันล่าสุดเท่านั้น: อัปเดตแอป (กด "อัปเดต" หรือปิดแล้วเปิดใหม่) แล้วรับอีกครั้ง', v_number using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists guard_transfer_receipt on public.branch_receipts;
create trigger guard_transfer_receipt before insert or update of transfer_order_id, branch_id on public.branch_receipts
  for each row execute function public.guard_transfer_receipt();

-- ── 10. The functions the app calls ──────────────────────────────────────────
-- An order's RM/PK deduction brought to its lines: only the difference, on the day it was
-- sent (lib/transfer-stock.ts distributionDeltas / distributionDate, the same rule)
create or replace function public.sync_transfer_distribution(p_to_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_to public.transfer_orders%rowtype;
  v_day date;
  v_n integer;
begin
  if auth.uid() is not null and not (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role)) then
    raise exception 'บัญชีนี้ปรับสต๊อกครัวไม่ได้' using errcode = '42501';
  end if;
  select * into v_to from public.transfer_orders where id = p_to_id for update;
  if not found or v_to.status not in ('Sent', 'Received', 'Partially Received') then
    return 0;
  end if;
  v_day := coalesce(
    (v_to.sent_at at time zone 'Asia/Bangkok')::date,
    (select min(a.adjustment_date) from public.stock_adjustments a where a.branch_id is null and a.reason in ('Distribution: ' || v_to.to_number, 'Distribution: ' || v_to.id::text)),
    v_to.delivery_date);
  insert into public.stock_adjustments (sku_id, quantity, stock_type, adjustment_date, reason)
  select coalesce(t.sku_id, c.sku_id), coalesce(t.qty, 0) - coalesce(c.qty, 0), coalesce(t.stock_type, c.stock_type), v_day, 'Distribution: ' || v_to.to_number
  from (
    select l.sku_id, l.sku_type as stock_type, -sum(l.actual_qty) as qty
    from public.transfer_order_lines l
    where l.to_id = p_to_id and l.sku_type in ('RM', 'PK') and l.actual_qty > 0
    group by l.sku_id, l.sku_type
  ) t
  full join (
    select a.sku_id, case when a.stock_type = 'PK' then 'PK' else 'RM' end as stock_type, sum(a.quantity) as qty
    from public.stock_adjustments a
    where a.branch_id is null and a.reason in ('Distribution: ' || v_to.to_number, 'Distribution: ' || v_to.id::text)
    group by 1, 2
  ) c on c.sku_id = t.sku_id and c.stock_type = t.stock_type
  where abs(coalesce(t.qty, 0) - coalesce(c.qty, 0)) > 0.000001;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- An order's receipts in the app's shape (branch_receipts *, transfer_orders(to_number)); runs with the caller's rights
create or replace function public.transfer_order_receipts(p_to_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(b) || jsonb_build_object('transfer_orders', jsonb_build_object('to_number', t.to_number)) order by b.created_at, b.id), '[]'::jsonb)
  from public.branch_receipts b
  join public.transfer_orders t on t.id = b.transfer_order_id
  where b.transfer_order_id = p_to_id
$$;

-- Receive: the order locked; still waiting (Sent, or received with nothing saved); receipts
-- and status saved together. Saving again answers "already" with what was saved.
create or replace function public.receive_transfer_order(p_to_id uuid, p_status text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_to public.transfer_orders%rowtype;
  v_uid uuid := auth.uid();
  v_branch uuid;
  v_saved integer;
  v_bad integer;
  v_over text;
begin
  if p_status not in ('Received', 'Partially Received') then
    raise exception 'สถานะรับของไม่ถูกต้อง: %', p_status using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'ไม่มีรายการที่รับ' using errcode = '22023';
  end if;
  select * into v_to from public.transfer_orders where id = p_to_id for update;
  if not found then
    return jsonb_build_object('result', 'gone');
  end if;
  -- Management, or the store manager of the order's branch (the receive page's own rule)
  if v_uid is not null and not has_role(v_uid, 'management'::app_role) then
    select p.branch_id into v_branch from public.profiles p where p.user_id = v_uid;
    if not has_role(v_uid, 'store_manager'::app_role) or v_branch is distinct from v_to.branch_id then
      raise exception 'บัญชีนี้รับของเข้าสาขานี้ไม่ได้' using errcode = '42501';
    end if;
  end if;
  select count(*) into v_saved from public.branch_receipts r where r.transfer_order_id = p_to_id;
  if v_saved > 0 then
    return jsonb_build_object('result', 'already', 'status', v_to.status, 'rows', public.transfer_order_receipts(p_to_id));
  end if;
  if v_to.status not in ('Sent', 'Received', 'Partially Received') then
    return jsonb_build_object('result', 'taken', 'status', v_to.status);
  end if;
  select count(*) into v_bad
  from jsonb_to_recordset(p_rows) as r(sku_id uuid, qty_received numeric, receipt_date date)
  where r.sku_id is null or r.receipt_date is null or coalesce(r.qty_received, 0) <= 0
     or not exists (select 1 from public.transfer_order_lines l where l.to_id = p_to_id and l.sku_id = r.sku_id);
  if v_bad > 0 then
    raise exception 'รายการรับไม่ตรงกับใบโอน %', v_to.to_number using errcode = '22023';
  end if;
  -- More than 3× what was sent (actual, else planned) is a typing slip (80,000 for 8,000)
  select s.name || ' ' || to_char(x.got, 'FM999,999,990.##') || ' (ส่งมา ' || to_char(x.sent, 'FM999,999,990.##') || ')' into v_over
  from (
    select r.sku_id, sum(r.qty_received) as got,
      (select sum(case when l.actual_qty > 0 then l.actual_qty else l.planned_qty end) from public.transfer_order_lines l where l.to_id = p_to_id and l.sku_id = r.sku_id) as sent
    from jsonb_to_recordset(p_rows) as r(sku_id uuid, qty_received numeric)
    group by r.sku_id
  ) x
  join public.skus s on s.id = x.sku_id
  where x.got > 3 * coalesce(x.sent, 0)
  limit 1;
  if v_over is not null then
    raise exception 'รับ % มากกว่าที่ส่งมาเกิน 3 เท่า ตรวจตัวเลขอีกครั้ง', v_over using errcode = '22023';
  end if;
  perform set_config('ck.receive_to', p_to_id::text, true);
  insert into public.branch_receipts (branch_id, receipt_date, sku_id, supplier_name, qty_received, uom, actual_unit_price, actual_total, std_unit_price, std_total, price_variance, notes, transfer_order_id)
  select v_to.branch_id, r.receipt_date, r.sku_id, coalesce(nullif(r.supplier_name, ''), 'Central Kitchen'), r.qty_received, coalesce(r.uom, ''),
         coalesce(r.actual_unit_price, 0), coalesce(r.actual_total, 0), coalesce(r.std_unit_price, 0), coalesce(r.std_total, 0), coalesce(r.price_variance, 0), coalesce(r.notes, ''), p_to_id
  from jsonb_to_recordset(p_rows) as r(receipt_date date, sku_id uuid, supplier_name text, qty_received numeric, uom text, actual_unit_price numeric, actual_total numeric, std_unit_price numeric, std_total numeric, price_variance numeric, notes text);
  perform set_config('ck.receive_to', '', true);
  update public.transfer_orders set status = p_status where id = p_to_id;
  if v_to.tr_id is not null then
    update public.transfer_requests set status = 'Fulfilled' where id = v_to.tr_id and status is distinct from 'Fulfilled';
  end if;
  return jsonb_build_object('result', 'saved', 'status', p_status, 'rows', public.transfer_order_receipts(p_to_id));
end $$;

-- Decline: the same lock and checks; the kitchen's RM/PK comes back through step 5
create or replace function public.decline_transfer_order(p_to_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_to public.transfer_orders%rowtype;
  v_uid uuid := auth.uid();
  v_branch uuid;
  v_saved integer;
begin
  select * into v_to from public.transfer_orders where id = p_to_id for update;
  if not found then
    return jsonb_build_object('result', 'gone');
  end if;
  if v_uid is not null and not has_role(v_uid, 'management'::app_role) then
    select p.branch_id into v_branch from public.profiles p where p.user_id = v_uid;
    if not has_role(v_uid, 'store_manager'::app_role) or v_branch is distinct from v_to.branch_id then
      raise exception 'บัญชีนี้ปฏิเสธใบโอนของสาขานี้ไม่ได้' using errcode = '42501';
    end if;
  end if;
  if v_to.status = 'Declined' then
    return jsonb_build_object('result', 'already', 'status', v_to.status);
  end if;
  select count(*) into v_saved from public.branch_receipts r where r.transfer_order_id = p_to_id;
  if v_saved > 0 then
    return jsonb_build_object('result', 'received', 'status', v_to.status);
  end if;
  if v_to.status not in ('Sent', 'Received', 'Partially Received') then
    return jsonb_build_object('result', 'taken', 'status', v_to.status);
  end if;
  update public.transfer_orders set status = 'Declined', decline_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = p_to_id;
  return jsonb_build_object('result', 'declined', 'status', 'Declined');
end $$;

-- Edit a sent order: lines, total and the RM/PK difference together. A line set to 0 means
-- "not sent" (lib/transfer-stock.ts planLineEdits, the same rule): its planned amount goes to 0
-- too (a 0 with the plan left read as the plan on the receive screen and in the SM sent while
-- "Sent", to-line-qty.ts) and its request line is declined, as at sending; refused when the
-- branch already has that product from the order. Only lines that change are looked at; one
-- brought back from 0 gets the branch's request again and its decline is cleared.
create or replace function public.save_sent_transfer_order(p_to_id uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_to public.transfer_orders%rowtype;
  v_n integer;
  v_refused text;
begin
  if auth.uid() is not null and not (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role)) then
    raise exception 'บัญชีนี้แก้ใบโอนไม่ได้' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'ไม่มีรายการ' using errcode = '22023';
  end if;
  select * into v_to from public.transfer_orders where id = p_to_id for update;
  if not found then
    return jsonb_build_object('result', 'gone');
  end if;
  if v_to.status not in ('Sent', 'Received', 'Partially Received') then
    return jsonb_build_object('result', 'taken', 'status', v_to.status);
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) as e(actual_qty numeric) where e.actual_qty is null or e.actual_qty < 0) then
    raise exception 'จำนวนไม่ถูกต้อง' using errcode = '22023';
  end if;
  select string_agg(distinct s.name, ', ') into v_refused
  from jsonb_to_recordset(p_lines) as e(id uuid, actual_qty numeric)
  join public.transfer_order_lines t on t.id = e.id and t.to_id = p_to_id
  join public.skus s on s.id = t.sku_id
  where e.actual_qty <= 0 and t.actual_qty > 0
    and exists (select 1 from public.branch_receipts r where r.transfer_order_id = p_to_id and r.sku_id = t.sku_id and r.qty_received > 0);
  if v_refused is not null then
    return jsonb_build_object('result', 'received_line', 'status', v_to.status, 'product', v_refused);
  end if;
  -- Request lines first (they read the lines as they were)
  update public.transfer_request_lines q
  set decline_reason = 'ครัวแก้เป็น 0 หลังส่ง', declined_at = now(), declined_by = (select p.id from public.profiles p where p.user_id = auth.uid())
  from jsonb_to_recordset(p_lines) as e(id uuid, actual_qty numeric)
  join public.transfer_order_lines t on t.id = e.id and t.to_id = p_to_id
  where q.id = t.tr_line_id and e.actual_qty <= 0 and t.actual_qty > 0;
  update public.transfer_request_lines q
  set decline_reason = null, declined_at = null, declined_by = null
  from jsonb_to_recordset(p_lines) as e(id uuid, actual_qty numeric)
  join public.transfer_order_lines t on t.id = e.id and t.to_id = p_to_id
  where q.id = t.tr_line_id and e.actual_qty > 0 and t.actual_qty <= 0 and t.planned_qty <= 0;
  perform set_config('ck.edit_to', p_to_id::text, true);
  update public.transfer_order_lines t
  set actual_qty = e.actual_qty,
      planned_qty = case
        when e.actual_qty <= 0 and t.actual_qty > 0 then 0
        when e.actual_qty > 0 and t.actual_qty <= 0 and t.planned_qty <= 0 then coalesce((select q.requested_qty from public.transfer_request_lines q where q.id = t.tr_line_id), t.planned_qty)
        else t.planned_qty end,
      line_value = e.actual_qty * t.unit_cost,
      notes = coalesce(e.notes, ''),
      packs_count = e.packs_count
  from jsonb_to_recordset(p_lines) as e(id uuid, actual_qty numeric, notes text, packs_count integer)
  where t.id = e.id and t.to_id = p_to_id;
  get diagnostics v_n = row_count;
  perform set_config('ck.edit_to', '', true);
  if v_n < jsonb_array_length(p_lines) then
    raise exception 'รายการไม่ตรงกับใบโอน %', v_to.to_number using errcode = '22023';
  end if;
  update public.transfer_orders set total_value = (select coalesce(sum(l.line_value), 0) from public.transfer_order_lines l where l.to_id = p_to_id) where id = p_to_id;
  perform public.sync_transfer_distribution(p_to_id);
  return jsonb_build_object('result', 'saved', 'status', v_to.status);
end $$;

-- Version, and when this file first ran (the repair's upper bound for old production edits)
do $$
declare v_at text;
begin
  begin
    v_at := public.ck_transfer_rules() ->> 'installed_at';
  exception when undefined_function then
    v_at := null;
  end;
  execute format('create or replace function public.ck_transfer_rules() returns jsonb language sql immutable as %L',
    format('select jsonb_build_object(%L, 2, %L, %L::timestamptz)', 'version', 'installed_at', coalesce(v_at, now()::text)));
end $$;

revoke all on function public.receive_transfer_order(uuid, text, jsonb) from public, anon;
revoke all on function public.decline_transfer_order(uuid, text) from public, anon;
revoke all on function public.save_sent_transfer_order(uuid, jsonb) from public, anon;
revoke all on function public.sync_transfer_distribution(uuid) from public, anon;
revoke all on function public.transfer_order_receipts(uuid) from public, anon;
revoke all on function public.ck_transfer_rules() from public, anon;
grant execute on function public.receive_transfer_order(uuid, text, jsonb) to authenticated;
grant execute on function public.decline_transfer_order(uuid, text) to authenticated;
grant execute on function public.save_sent_transfer_order(uuid, jsonb) to authenticated;
grant execute on function public.sync_transfer_distribution(uuid) to authenticated;
grant execute on function public.transfer_order_receipts(uuid) to authenticated;
grant execute on function public.ck_transfer_rules() to authenticated;

-- ── 11. "TO sent" LINE message: a real send only ─────────────────────────────
-- Same body as 20261031150000_report_key_gate.sql; only the condition changes (an order
-- given back to Sent after a receive that didn't finish is not a new send)
create or replace function public.notify_to_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'Sent' and old.status = 'Draft' then
    begin
      perform
        net.http_post(
          url := 'https://lyhhaeikbvhmjpyjhdbg.supabase.co/functions/v1/to-sent-report',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-report-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'report_key'), '')
          ),
          body := jsonb_build_object('to_id', new.id)
        );
    exception when others then
      raise warning 'notify_to_sent: could not queue to-sent-report for TO %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
