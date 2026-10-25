-- Cost Center foundation
-- 1) CK managers can change product data (Bucci, 26 Oct 2026). Until now only
--    management could write these tables, while the screens let CK managers try.
--    Deleting products, suppliers and categories stays with management (the app
--    switches them off instead).
-- 2) change_log: every change to product/recipe/menu data, written by the database
--    itself (who, when, before → after), so the app can show history and undo.

-- ── 1. Write access for ck_manager ──
do $$
declare t text;
begin
  foreach t in array array['skus','prices','suppliers','sku_categories','bom_headers','bom_lines','bom_steps','bom_byproducts','sp_bom'] loop
    execute format('drop policy if exists "Management can insert %1$s" on public.%1$I', t);
    execute format('drop policy if exists "Management can update %1$s" on public.%1$I', t);
    execute format('drop policy if exists "Management or CK can insert %1$s" on public.%1$I', t);
    execute format('drop policy if exists "Management or CK can update %1$s" on public.%1$I', t);
    execute format($p$create policy "Management or CK can insert %1$s" on public.%1$I for insert to authenticated
      with check (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role))$p$, t);
    execute format($p$create policy "Management or CK can update %1$s" on public.%1$I for update to authenticated
      using (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role))$p$, t);
  end loop;
  -- Recipe lines, steps, by-products and prices are edited by removing rows too
  foreach t in array array['prices','bom_lines','bom_steps','bom_byproducts','sp_bom'] loop
    execute format('drop policy if exists "Management can delete %1$s" on public.%1$I', t);
    execute format('drop policy if exists "Management or CK can delete %1$s" on public.%1$I', t);
    execute format($p$create policy "Management or CK can delete %1$s" on public.%1$I for delete to authenticated
      using (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role))$p$, t);
  end loop;
end $$;

-- ── 2. Change history ──
create table if not exists public.change_log (
  id bigserial primary key,
  table_name text not null,
  row_id text,                   -- the row's id (text so any id type works)
  op text not null,              -- INSERT | UPDATE | DELETE
  old_row jsonb,
  new_row jsonb,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create index if not exists change_log_row_idx on public.change_log (table_name, row_id, changed_at desc);
create index if not exists change_log_time_idx on public.change_log (changed_at desc);

alter table public.change_log enable row level security;
drop policy if exists "Management or CK can view change_log" on public.change_log;
create policy "Management or CK can view change_log" on public.change_log for select to authenticated
  using (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role));
-- No insert/update/delete policies: only the trigger below writes, and history can't be edited.

create or replace function public.log_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  -- Bookkeeping columns: a change to only these isn't worth a history line
  quiet text[] := array['updated_at','cost_per_serving','cost_per_unit'];
  k text;
  real_change boolean := tg_op <> 'UPDATE';
begin
  -- Recipe costs written by the system ("BOM Calculation" prices) are results, not edits
  if tg_table_name = 'prices' and coalesce(n->>'supplier_id', o->>'supplier_id') = '45cd33bb-82b7-4865-be1e-3c88f085cc72' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if not (k = any(quiet)) and (o->k) is distinct from (n->k) then real_change := true; exit; end if;
    end loop;
  end if;
  if real_change then
    insert into public.change_log (table_name, row_id, op, old_row, new_row)
    values (tg_table_name, coalesce(n->>'id', o->>'id'), tg_op, o, n);
  end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['skus','prices','suppliers','sku_categories','bom_headers','bom_lines','bom_steps','bom_byproducts','sp_bom','menus','menu_bom'] loop
    execute format('drop trigger if exists log_change_%1$s on public.%1$I', t);
    execute format('create trigger log_change_%1$s after insert or update or delete on public.%1$I for each row execute function public.log_change()', t);
  end loop;
end $$;
