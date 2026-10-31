-- Transfer orders keep stock right however they are changed (1 Nov 2026).
--
-- Written for the live database as Bucci's checks 0a / 0b showed it (1 Nov 2026), which has
-- policies the repo's migrations don't: store managers had two update policies on
-- transfer_orders ("Store Manager can decline transfer orders", "Store manager receive own TO")
-- and an insert on stock_adjustments with no branch check; the CK manager had no update on
-- transfer_request_lines. The live triggers on transfer_orders are the repo's own
-- (set_sent_at, set_updated_at, notify_to_sent, validate_to_status); 0 prints their current
-- definitions, and the three this file depends on are replaced explicitly (3b, 4, 11).
--
-- What this does (the app has the same rules in lib/transfer-stock.ts):
--  0. Prints the live policies on the five tables and the live triggers on transfer_orders.
--  1. A receipt keeps its transfer order: deleting an order the branch had received set
--     branch_receipts.transfer_order_id to empty, so the receipt read as a supplier's
--     (× unit converter) while the order's stock went back to the kitchen as well.
--  2. Only an unsent (Draft) or cancelled order can be deleted, and its lines with it.
--  3. Status only moves on. A new order starts as Draft and a Draft only becomes Sent or
--     Cancelled; nothing comes back from Cancelled or Declined; an order the branch has receipts
--     for stays received. "Received" with no receipt saved is a receive that didn't finish: it
--     still waits. A store manager changes an order only through receive / decline (10), and
--     only its status and decline reason, even if some policy still lets them update.
--     3b. The status-value check (trg_validate_to_status) replaced with the same six values.
--  4. sent_at: set on a send; a send put back to Draft clears it (the next send dates the
--     order again). Replaces the live function.
--  5. Cancelled / declined: the order's RM/PK "Distribution:" rows go in the same step (its SM
--     comes back by the status), also when a branch declines.
--  6. Distribution rows are written only by the kitchen, only for a sent order, and removed
--     only for one that isn't sent any more.
--  7. Quantities on a sent order whose RM/PK is out change only through
--     save_sent_transfer_order, which moves lines and deduction together.
--  8. The two store-manager update policies on transfer_orders are dropped (logged) and one
--     narrow one (own branch, Sent) is kept so an old app's direct update meets the guard's
--     "update the app" instead of a silent no-op; a WARNING names any other one left.
--  9. Receipts of kitchen goods on an order: saved only through receive_transfer_order, into
--     the order's branch; a store manager can't edit or delete them (management corrects them,
--     or the kitchen edits the order). Supplier receipts are the branch's own, as before.
-- 10. The functions the app calls (one transaction each): receive_transfer_order (refuses more
--     than 3× what was sent: a typing slip), decline_transfer_order, save_sent_transfer_order
--     (a line set to 0 = not sent), sync_transfer_distribution, move_branch_stock, and
--     ck_transfer_rules (version + when this was first run).
-- 11. The "TO sent" LINE message goes out on a real send only (Draft → Sent).
-- 12. stock_adjustments: a store manager writes waste and corrections of their own branch
--     directly; moving stock to another branch or back to the kitchen goes through
--     move_branch_stock, which writes both sides together (the live policy let a store manager
--     write any row, the kitchen's included).
-- 13. The CK manager may mark request lines "ส่งไม่ได้" (those columns only): the live policies
--     let only management, so the kitchen's decline reasons were dropped without a word.
--
-- Order: the app update goes live first, then this file. An older copy of the app still open
-- on a tablet is then refused before it saves anything, with a message to update, for a
-- receive, a decline, a change of quantities on a sent order or a move between places; its
-- send, cancel, waste and corrections still work. Safe to run more than once.

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
  -- The live triggers as they are before this file replaces some of them (send these if anything looks odd)
  for r in
    select t.tgname, pg_get_triggerdef(t.oid) as def, pg_get_functiondef(t.tgfoid) as fn
    from pg_trigger t
    where t.tgrelid = 'public.transfer_orders'::regclass and not t.tgisinternal
    order by t.tgname
  loop
    raise notice 'trigger before: %', r.def;
    raise notice 'its function before: %', r.fn;
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
  -- A store manager changes an order only inside receive_transfer_order / decline_transfer_order
  -- (they set ck.branch_to), whatever policy might let them update; deleting a request empties
  -- tr_id on its orders by itself (on delete set null)
  if v_branch_only and not (
      coalesce(current_setting('ck.branch_to', true), '') = old.id::text
      or ((to_jsonb(new) - 'tr_id') = (to_jsonb(old) - 'tr_id') and new.tr_id is null)) then
    raise exception 'สาขารับหรือปฏิเสธใบโอนได้จากแอปเวอร์ชันล่าสุดเท่านั้น: อัปเดตแอปแล้วลองใหม่' using errcode = 'P0001';
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

-- ── 3b. Status values: trg_validate_to_status replaced explicitly ────────────
-- The repo's version (20260411052141) only checks the value is one of these six; the moves are
-- checked in 3. Replaced so whatever the live body holds can't refuse a move 3 allows
-- (a receive that didn't finish → cancelled, a failed send → draft).
create or replace function public.validate_transfer_order_status()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.status not in ('Draft', 'Sent', 'Received', 'Partially Received', 'Cancelled', 'Declined') then
    raise exception 'Invalid transfer order status: %', new.status;
  end if;
  return new;
end $$;
drop trigger if exists trg_validate_to_status on public.transfer_orders;
create trigger trg_validate_to_status before insert or update on public.transfer_orders
  for each row execute function public.validate_transfer_order_status();

-- ── 4. sent_at: set on a send, cleared when the send is put back to Draft ────
-- Replaces the live function (the repo's 20261025200000 sets it once, on the first send).
-- BEFORE triggers fire by name: guard_… (3), set_sent_at_…, set_updated_at_…, trg_validate_…;
-- only this one touches sent_at.
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

-- ── 8. Store managers don't update transfer_orders directly any more ─────────
do $$
declare r record;
begin
  for r in
    select policyname, cmd, coalesce(qual, '-') as qual, coalesce(with_check, '-') as with_check
    from pg_policies
    where schemaname = 'public' and tablename = 'transfer_orders' and policyname in ('Store Manager can decline transfer orders', 'Store manager receive own TO')
  loop
    raise notice 'dropping transfer_orders policy "%" (% · using: % · check: %): receive / decline go through receive_transfer_order / decline_transfer_order', r.policyname, r.cmd, r.qual, r.with_check;
  end loop;
end $$;
drop policy if exists "Store Manager can decline transfer orders" on public.transfer_orders;
drop policy if exists "Store manager receive own TO" on public.transfer_orders;
-- One narrow policy stays on purpose: an older copy of the app updating a waiting order directly
-- then reaches guard_transfer_order_status, which answers "update the app" (with no policy at all
-- the update would match nothing and the old app would report a decline that never happened)
drop policy if exists "Store manager own sent TO (guarded)" on public.transfer_orders;
create policy "Store manager own sent TO (guarded)" on public.transfer_orders for update to authenticated
  using (
    has_role(auth.uid(), 'store_manager'::app_role)
    and status = 'Sent'
    and branch_id = (select profiles.branch_id from public.profiles where profiles.user_id = auth.uid())
  )
  with check (
    has_role(auth.uid(), 'store_manager'::app_role)
    and branch_id = (select profiles.branch_id from public.profiles where profiles.user_id = auth.uid())
  );
do $$
declare r record;
begin
  for r in
    select policyname, cmd, coalesce(qual, 'true') as qual
    from pg_policies
    where schemaname = 'public' and tablename = 'transfer_orders' and cmd in ('UPDATE', 'ALL')
      and policyname not in ('Management full update TO', 'CK manager full update TO', 'Store manager own sent TO (guarded)')
  loop
    raise warning 'transfer_orders still has update policy "%" (%): %. Left as it is: a store manager''s direct update through it is refused by guard_transfer_order_status. Drop it if it isn''t meant.', r.policyname, r.cmd, r.qual;
  end loop;
end $$;

-- ── 9. Receipts of kitchen goods on an order ─────────────────────────────────
-- Saved only through receive_transfer_order, into the order's branch. A store manager can't
-- edit or delete them (management corrects them, or the kitchen edits the order); a link or
-- branch can't be changed from the app at all. Supplier receipts (no order) are untouched.
create or replace function public.guard_transfer_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_manager boolean := v_uid is null or has_role(v_uid, 'management'::app_role);
  v_branch uuid;
  v_number text;
begin
  if tg_op = 'DELETE' then
    if old.transfer_order_id is not null and not v_manager then
      raise exception 'ลบรายการรับของจากใบโอนไม่ได้: ให้ผู้บริหารแก้ หรือครัวกลางแก้ใบโอน' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.transfer_order_id is null and new.transfer_order_id is null then
      return new; -- a supplier's receipt: the branch's own
    end if;
    if new.transfer_order_id is distinct from old.transfer_order_id or new.branch_id is distinct from old.branch_id then
      -- Unlinking turned kitchen goods into a supplier's (× unit converter)
      if v_uid is not null then
        raise exception 'เปลี่ยนใบโอนหรือสาขาของรายการรับของไม่ได้ ลบแล้วรับใหม่แทน' using errcode = 'P0001';
      end if;
    elsif not v_manager then
      raise exception 'รายการรับของจากใบโอนแก้ได้โดยผู้บริหารเท่านั้น (หรือครัวกลางแก้ใบโอน)' using errcode = 'P0001';
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
  if tg_op = 'INSERT' and v_uid is not null and current_setting('ck.receive_to', true) is distinct from new.transfer_order_id::text then
    raise exception 'รับของจากใบโอน % ได้จากแอปเวอร์ชันล่าสุดเท่านั้น: อัปเดตแอป (กด "อัปเดต" หรือปิดแล้วเปิดใหม่) แล้วรับอีกครั้ง', v_number using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists guard_transfer_receipt on public.branch_receipts;
create trigger guard_transfer_receipt before insert or update or delete on public.branch_receipts
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
  perform set_config('ck.branch_to', p_to_id::text, true);
  update public.transfer_orders set status = p_status where id = p_to_id;
  perform set_config('ck.branch_to', '', true);
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
  perform set_config('ck.branch_to', p_to_id::text, true);
  update public.transfer_orders set status = 'Declined', decline_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = p_to_id;
  perform set_config('ck.branch_to', '', true);
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

-- ── 12. stock_adjustments: what a store manager writes ───────────────────────
-- The live "Store Manager can insert stock_adjustments" checked only the role: a store manager
-- could write any branch's rows, or the kitchen's. MoveSheet (store stock) writes these, all from
-- lib/branch-stock.ts moveRows:
--   waste   own branch −q  "ของเสีย / หมดอายุ[: note]"
--   fix     own branch ±q  "แก้ไขความผิดพลาด: note"
--   branch  own branch −q  "โอนให้สาขาอื่น → <to>[: note]"   + other branch +q "รับโอนจากสาขาอื่น → <from>[: note]"
--   kitchen own branch −q  "ส่งคืนครัวกลาง[: note]"           + kitchen (no branch) +q "รับคืนจากสาขา <from>[: note]"
-- Waste and fixes stay direct, own branch only. The two-sided moves go through move_branch_stock,
-- which writes both rows together only when they match (same product, day, unit, opposite amounts).
do $$
declare r record;
begin
  for r in select policyname, cmd, coalesce(with_check, '-') as with_check from pg_policies where schemaname = 'public' and tablename = 'stock_adjustments' and policyname = 'Store Manager can insert stock_adjustments' loop
    raise notice 'replacing stock_adjustments policy "%" (% · check: %) with "Store manager insert own branch waste or fix" + move_branch_stock', r.policyname, r.cmd, r.with_check;
  end loop;
end $$;
drop policy if exists "Store Manager can insert stock_adjustments" on public.stock_adjustments;
drop policy if exists "Store manager insert own branch waste or fix" on public.stock_adjustments;
create policy "Store manager insert own branch waste or fix" on public.stock_adjustments for insert to authenticated
  with check (
    has_role(auth.uid(), 'store_manager'::app_role)
    and branch_id = (select profiles.branch_id from public.profiles where profiles.user_id = auth.uid())
    and (((reason = 'ของเสีย / หมดอายุ' or reason like 'ของเสีย / หมดอายุ: %') and quantity < 0) or reason like 'แก้ไขความผิดพลาด: %')
    -- A count's own adjustment is never typed in ("Stock Count" rows don't move stock again)
    and reason !~* 'stock[[:space:]]*count'
  );

create or replace function public.move_branch_stock(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_kitchen boolean := v_uid is null or has_role(v_uid, 'management'::app_role) or has_role(v_uid, 'ck_manager'::app_role);
  v_own uuid;
  v_n integer;
  a record;
  b record;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not in (1, 2) then
    raise exception 'ย้ายของได้ทีละ 1 รายการ' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_rows);
  if not v_kitchen then
    if not has_role(v_uid, 'store_manager'::app_role) then
      raise exception 'บัญชีนี้ย้ายของไม่ได้' using errcode = '42501';
    end if;
    select p.branch_id into v_own from public.profiles p where p.user_id = v_uid;
  end if;
  select * into a from jsonb_to_record(p_rows -> 0) as x(branch_id uuid, sku_id uuid, adjustment_date date, quantity numeric, reason text, stock_type text);
  if a.branch_id is null or (not v_kitchen and a.branch_id is distinct from v_own) then
    raise exception 'ย้ายได้เฉพาะของสาขาตัวเอง' using errcode = '42501';
  end if;
  if a.sku_id is null or a.adjustment_date is null or coalesce(a.quantity, 0) = 0 or a.reason is null
     or a.stock_type is distinct from (select s.type from public.skus s where s.id = a.sku_id) then
    raise exception 'รายการย้ายของไม่ถูกต้อง' using errcode = '22023';
  end if;
  -- "Stock Count" marks a count's own adjustment (left out of balances): never one typed in
  if exists (select 1 from jsonb_array_elements(p_rows) e where e ->> 'reason' ~* 'stock[[:space:]]*count') then
    raise exception 'เหตุผลนี้ใช้ไม่ได้' using errcode = '22023';
  end if;
  if v_n = 1 then
    if not (((a.reason = 'ของเสีย / หมดอายุ' or a.reason like 'ของเสีย / หมดอายุ: %') and a.quantity < 0) or a.reason like 'แก้ไขความผิดพลาด: %') then
      raise exception 'รายการย้ายของไม่ถูกต้อง' using errcode = '22023';
    end if;
  else
    select * into b from jsonb_to_record(p_rows -> 1) as x(branch_id uuid, sku_id uuid, adjustment_date date, quantity numeric, reason text, stock_type text);
    -- The two sides carry the same note (moveRows adds ": <note>" to both)
    if not (a.quantity < 0 and b.quantity = -a.quantity and b.sku_id = a.sku_id and b.adjustment_date = a.adjustment_date and b.stock_type = a.stock_type
            and coalesce(substring(a.reason from ': (.*)$'), '') = coalesce(substring(b.reason from ': (.*)$'), '')
            and ((a.reason like 'โอนให้สาขาอื่น → %' and b.reason like 'รับโอนจากสาขาอื่น → %' and b.branch_id is not null and b.branch_id <> a.branch_id)
              or ((a.reason = 'ส่งคืนครัวกลาง' or a.reason like 'ส่งคืนครัวกลาง: %') and b.reason like 'รับคืนจากสาขา %' and b.branch_id is null))) then
      raise exception 'การย้ายของต้องบันทึกสองฝั่งเท่ากัน' using errcode = '22023';
    end if;
  end if;
  insert into public.stock_adjustments (branch_id, sku_id, adjustment_date, quantity, reason, stock_type)
  select x.branch_id, x.sku_id, x.adjustment_date, x.quantity, x.reason, x.stock_type
  from jsonb_to_recordset(p_rows) as x(branch_id uuid, sku_id uuid, adjustment_date date, quantity numeric, reason text, stock_type text);
  return v_n;
end $$;
revoke all on function public.move_branch_stock(jsonb) from public, anon;
grant execute on function public.move_branch_stock(jsonb) to authenticated;

-- ── 13. The CK manager marks request lines "ส่งไม่ได้" ───────────────────────
-- Live, only management could update transfer_request_lines (store managers their own branch's):
-- the kitchen's decline reasons were dropped without an error. Those three columns only.
drop policy if exists "CK manager decline TRL" on public.transfer_request_lines;
create policy "CK manager decline TRL" on public.transfer_request_lines for update to authenticated
  using (has_role(auth.uid(), 'ck_manager'::app_role))
  with check (has_role(auth.uid(), 'ck_manager'::app_role));

create or replace function public.guard_request_line_kitchen_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  -- Management only is exempt: a CK manager who is also a store manager is still limited here
  if v_uid is not null and has_role(v_uid, 'ck_manager'::app_role) and not has_role(v_uid, 'management'::app_role)
     and (to_jsonb(new) - array['decline_reason', 'declined_at', 'declined_by']) is distinct from (to_jsonb(old) - array['decline_reason', 'declined_at', 'declined_by']) then
    raise exception 'ครัวกลางแก้ได้เฉพาะเหตุผลที่ส่งไม่ได้ในใบขอเบิก' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists guard_request_line_kitchen_update on public.transfer_request_lines;
create trigger guard_request_line_kitchen_update before update on public.transfer_request_lines
  for each row execute function public.guard_request_line_kitchen_update();
