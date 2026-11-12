-- WIP: an item a branch makes itself from what it has (ชาชูรวม = chashu trimmings),
-- with no fixed recipe. Each batch records what actually went in, by weight:
--   · the inputs come out of the branch's stock, the WIP goes in (stock_adjustments
--     at the branch, tagged "[wip <batch id>]", read by every branch balance as is)
--   · the batch's cost = what went in at each input's price per gram; the WIP's
--     price is the weighted cost of its recent batches (the "BOM Calculation" price
--     row, so menus, food cost and stock value read it like any recipe item)
-- SP stays as it was (a fixed recipe expanded at the sale).

-- What may go into each WIP (a list, not a recipe: no amounts)
create table if not exists public.wip_inputs (
  id uuid primary key default gen_random_uuid(),
  wip_sku_id uuid not null references public.skus(id) on delete cascade,
  sku_id uuid not null references public.skus(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (wip_sku_id, sku_id),
  check (wip_sku_id <> sku_id)
);

create table if not exists public.wip_batches (
  id uuid primary key,
  branch_id uuid not null references public.branches(id),
  wip_sku_id uuid not null references public.skus(id),
  made_date date not null,
  output_qty numeric not null check (output_qty > 0),
  input_qty numeric not null check (input_qty > 0),
  cost_per_unit numeric not null default 0,
  note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists wip_batches_branch_date on public.wip_batches (branch_id, made_date);
create index if not exists wip_batches_wip_date on public.wip_batches (wip_sku_id, made_date);

create table if not exists public.wip_batch_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.wip_batches(id) on delete cascade,
  sku_id uuid not null references public.skus(id),
  qty numeric not null check (qty > 0),
  unit_cost numeric not null default 0
);
create index if not exists wip_batch_lines_batch on public.wip_batch_lines (batch_id);

alter table public.wip_inputs enable row level security;
alter table public.wip_batches enable row level security;
alter table public.wip_batch_lines enable row level security;

drop policy if exists "Signed in can read wip_inputs" on public.wip_inputs;
create policy "Signed in can read wip_inputs" on public.wip_inputs for select to authenticated using (true);
drop policy if exists "Kitchen manages wip_inputs" on public.wip_inputs;
create policy "Kitchen manages wip_inputs" on public.wip_inputs for all to authenticated
  using (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role))
  with check (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role));

-- Batches are read by anyone signed in (food cost, stock pages) and written only through the functions below
drop policy if exists "Signed in can read wip_batches" on public.wip_batches;
create policy "Signed in can read wip_batches" on public.wip_batches for select to authenticated using (true);
drop policy if exists "Signed in can read wip_batch_lines" on public.wip_batch_lines;
create policy "Signed in can read wip_batch_lines" on public.wip_batch_lines for select to authenticated using (true);

-- Who may write a batch for a branch: the kitchen/management for any, a store manager for their own
create or replace function public.wip_can_write(p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is null
      or has_role(auth.uid(), 'management'::app_role)
      or has_role(auth.uid(), 'ck_manager'::app_role)
      or (has_role(auth.uid(), 'store_manager'::app_role)
          and p_branch = (select p.branch_id from public.profiles p where p.user_id = auth.uid()));
$$;

-- The WIP's price: the weighted cost of its batches over the last 30 days (all branches),
-- written as its one active "BOM Calculation" price (as a recipe item's cost is)
create or replace function public.wip_reprice(p_wip uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_cost numeric;
  v_keep uuid;
  v_bom uuid := '45cd33bb-82b7-4865-be1e-3c88f085cc72';
begin
  select sum(b.cost_per_unit * b.output_qty) / nullif(sum(b.output_qty), 0) into v_cost
  from public.wip_batches b
  where b.wip_sku_id = p_wip and b.made_date >= current_date - 30 and b.cost_per_unit > 0;
  -- Nothing made in 30 days (or the batches were deleted): the latest batch ever, else leave the price as it is
  if v_cost is null then
    select b.cost_per_unit into v_cost from public.wip_batches b where b.wip_sku_id = p_wip and b.cost_per_unit > 0 order by b.made_date desc, b.created_at desc limit 1;
  end if;
  if v_cost is null then return null; end if;
  select id into v_keep from public.prices where sku_id = p_wip and supplier_id = v_bom and is_active order by created_at desc limit 1;
  if v_keep is null then
    insert into public.prices (sku_id, supplier_id, price_per_purchase_uom, price_per_usage_uom, vat, is_active, effective_date, note)
    values (p_wip, v_bom, 0, v_cost, false, true, current_date, 'WIP: ต้นทุนเฉลี่ยจากรอบที่ทำ 30 วัน — คำนวณเอง ห้ามแก้')
    returning id into v_keep;
  else
    update public.prices set price_per_purchase_uom = 0, price_per_usage_uom = v_cost, effective_date = current_date,
      note = 'WIP: ต้นทุนเฉลี่ยจากรอบที่ทำ 30 วัน — คำนวณเอง ห้ามแก้'
    where id = v_keep and price_per_usage_uom is distinct from v_cost;
  end if;
  update public.prices set is_active = false where sku_id = p_wip and is_active and id <> v_keep;
  return v_cost;
end $$;

-- A branch's count of that day is sent: what it moved is in that count, so nothing may change it
create or replace function public.wip_day_closed(p_branch uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.daily_stock_counts c where c.branch_id = p_branch and c.count_date = p_date and c.is_submitted);
$$;

/**
 * Save a batch (new, or the same id again = replace it: an edit, or a save pressed twice).
 * p_lines: [{ "sku_id": uuid, "qty": number }]. All or nothing: the batch, its lines and
 * the stock moves (inputs out, WIP in) land together.
 */
create or replace function public.save_wip_batch(
  p_id uuid, p_branch uuid, p_wip uuid, p_date date, p_output numeric, p_lines jsonb, p_note text default ''
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old record;
  v_wip record;
  v_in numeric := 0;
  v_cost numeric := 0;
  v_tag text := '[wip ' || p_id || ']';
  l record;
begin
  if p_id is null or p_branch is null or p_wip is null or p_date is null then
    raise exception 'ข้อมูลไม่ครบ' using errcode = '22023';
  end if;
  if not public.wip_can_write(p_branch) then
    raise exception 'บันทึกได้เฉพาะสาขาตัวเอง' using errcode = '42501';
  end if;
  select id, name, type into v_wip from public.skus where id = p_wip;
  if v_wip.id is null or v_wip.type <> 'WIP' then
    raise exception 'สินค้านี้ไม่ใช่ WIP' using errcode = '22023';
  end if;
  if coalesce(p_output, 0) <= 0 then
    raise exception 'ใส่น้ำหนักที่ได้' using errcode = '22023';
  end if;
  select * into v_old from public.wip_batches where id = p_id;
  if v_old.id is not null and (v_old.branch_id <> p_branch or v_old.wip_sku_id <> p_wip) then
    raise exception 'รายการนี้เป็นของสาขาหรือสินค้าอื่น' using errcode = '22023';
  end if;
  -- A branch records around today only (counting after midnight still belongs to yesterday);
  -- the kitchen/management may fix an older day
  if not (auth.uid() is null or has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role))
     and (p_date < current_date - 2 or p_date > current_date + 1) then
    raise exception 'บันทึกได้เฉพาะวันนี้หรือเมื่อวาน' using errcode = '22023';
  end if;
  if public.wip_day_closed(p_branch, p_date) or (v_old.id is not null and public.wip_day_closed(v_old.branch_id, v_old.made_date)) then
    raise exception 'ส่งใบนับของวันนั้นแล้ว แก้ไม่ได้' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'ใส่ของที่ใช้อย่างน้อย 1 อย่าง' using errcode = '22023';
  end if;
  -- Every input: on the WIP's list, more than 0, once
  if exists (
    select 1 from jsonb_to_recordset(p_lines) x(sku_id uuid, qty numeric)
    where x.sku_id is null or coalesce(x.qty, 0) <= 0
       or not (exists (select 1 from public.wip_inputs w where w.wip_sku_id = p_wip and w.sku_id = x.sku_id)
               -- an edit keeps what the batch had, even if it was taken off the list since
               or exists (select 1 from public.wip_batch_lines o where o.batch_id = p_id and o.sku_id = x.sku_id))
  ) then
    raise exception 'มีของที่ใส่ไม่ได้ หรือน้ำหนักไม่ถูกต้อง' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_to_recordset(p_lines) x(sku_id uuid, qty numeric)) <> (select count(distinct x.sku_id) from jsonb_to_recordset(p_lines) x(sku_id uuid, qty numeric)) then
    raise exception 'ของซ้ำกัน' using errcode = '22023';
  end if;

  -- Replace: the old batch's moves and lines go first (its stock comes back)
  delete from public.stock_adjustments where branch_id = p_branch and reason like 'WIP: %' and reason like '%' || v_tag;
  delete from public.wip_batches where id = p_id;

  insert into public.wip_batches (id, branch_id, wip_sku_id, made_date, output_qty, input_qty, note, created_by)
  values (p_id, p_branch, p_wip, p_date, p_output, 1, coalesce(p_note, ''), auth.uid());

  for l in
    select x.sku_id, x.qty, s.type, s.name,
           coalesce((select p.price_per_usage_uom from public.prices p where p.sku_id = x.sku_id and p.is_active order by p.effective_date desc, p.created_at desc limit 1), 0) as price
    from jsonb_to_recordset(p_lines) x(sku_id uuid, qty numeric) join public.skus s on s.id = x.sku_id
  loop
    insert into public.wip_batch_lines (batch_id, sku_id, qty, unit_cost) values (p_id, l.sku_id, l.qty, l.price);
    insert into public.stock_adjustments (branch_id, sku_id, adjustment_date, quantity, reason, stock_type)
    values (p_branch, l.sku_id, p_date, -l.qty, 'WIP: ใช้ทำ' || v_wip.name || ' ' || v_tag, l.type);
    v_in := v_in + l.qty;
    v_cost := v_cost + l.qty * l.price;
  end loop;

  insert into public.stock_adjustments (branch_id, sku_id, adjustment_date, quantity, reason, stock_type)
  values (p_branch, p_wip, p_date, p_output, 'WIP: ทำ' || v_wip.name || ' ' || v_tag, 'WIP');

  update public.wip_batches set input_qty = v_in, cost_per_unit = v_cost / p_output where id = p_id;
  perform public.wip_reprice(p_wip);
  return jsonb_build_object('id', p_id, 'input_qty', v_in, 'cost_per_unit', v_cost / p_output);
exception when unique_violation then
  -- Pressed again while the first save was still landing: that one saved the same batch
  if exists (select 1 from public.wip_batches where id = p_id) then
    return jsonb_build_object('id', p_id, 'again', true);
  end if;
  raise;
end $$;

/** Delete a batch: its moves come back out (inputs return, the WIP goes) */
create or replace function public.delete_wip_batch(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_old record;
begin
  select * into v_old from public.wip_batches where id = p_id;
  if v_old.id is null then return false; end if;
  if not public.wip_can_write(v_old.branch_id) then
    raise exception 'ลบได้เฉพาะของสาขาตัวเอง' using errcode = '42501';
  end if;
  if public.wip_day_closed(v_old.branch_id, v_old.made_date) then
    raise exception 'ส่งใบนับของวันนั้นแล้ว ลบไม่ได้' using errcode = '22023';
  end if;
  delete from public.stock_adjustments where branch_id = v_old.branch_id and reason like 'WIP: %' and reason like '%[wip ' || p_id || ']';
  delete from public.wip_batches where id = p_id;
  perform public.wip_reprice(v_old.wip_sku_id);
  return true;
end $$;

revoke all on function public.save_wip_batch(uuid, uuid, uuid, date, numeric, jsonb, text) from public, anon;
revoke all on function public.delete_wip_batch(uuid) from public, anon;
revoke all on function public.wip_reprice(uuid) from public, anon, authenticated;
grant execute on function public.save_wip_batch(uuid, uuid, uuid, date, numeric, jsonb, text) to authenticated;
grant execute on function public.delete_wip_batch(uuid) to authenticated;

notify pgrst, 'reload schema';
