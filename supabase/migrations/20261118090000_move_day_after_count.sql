-- A move's two sides may fall on different days (18 Nov 2026).
--
-- A branch whose count for today is already sent gets its side of a move on tomorrow
-- (its sheet for today can't take it; written today it read as a loss on the next count:
-- Thaniya 13 Nov, a 40-piece transfer showed as 40 "over-used"). The app moves its own side
-- (and says so); this function moves any branch side whose day is sent (the receiver's too,
-- which a store manager can't see), and lets the two sides be a day apart. The kitchen's side
-- (no branch) keeps its day. Nothing else changes.
-- Run BEFORE publishing the app that sends it (the old rule refuses it, nothing saved).

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
    if not (a.quantity < 0 and b.quantity = -a.quantity and b.sku_id = a.sku_id and b.adjustment_date between a.adjustment_date - 1 and a.adjustment_date + 1 and b.stock_type = a.stock_type
            and coalesce(substring(a.reason from ': (.*)$'), '') = coalesce(substring(b.reason from ': (.*)$'), '')
            and ((a.reason like 'โอนให้สาขาอื่น → %' and b.reason like 'รับโอนจากสาขาอื่น → %' and b.branch_id is not null and b.branch_id <> a.branch_id)
              or ((a.reason = 'ส่งคืนครัวกลาง' or a.reason like 'ส่งคืนครัวกลาง: %') and b.reason like 'รับคืนจากสาขา %' and b.branch_id is null))) then
      raise exception 'การย้ายของต้องบันทึกสองฝั่งเท่ากัน' using errcode = '22023';
    end if;
  end if;
  -- A branch side whose count for that day is already sent goes to the next day (checked here
  -- too: a store manager's app can't read another branch's counts to know the receiver's)
  insert into public.stock_adjustments (branch_id, sku_id, adjustment_date, quantity, reason, stock_type)
  select x.branch_id, x.sku_id,
         case when x.branch_id is not null and exists (
                select 1 from public.daily_stock_counts c
                where c.branch_id = x.branch_id and c.count_date = x.adjustment_date and c.is_submitted)
              then x.adjustment_date + 1 else x.adjustment_date end,
         x.quantity, x.reason, x.stock_type
  from jsonb_to_recordset(p_rows) as x(branch_id uuid, sku_id uuid, adjustment_date date, quantity numeric, reason text, stock_type text);
  return v_n;
end $$;
revoke all on function public.move_branch_stock(jsonb) from public, anon;
grant execute on function public.move_branch_stock(jsonb) to authenticated;

notify pgrst, 'reload schema';
