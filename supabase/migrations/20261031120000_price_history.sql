-- Price history: every item's standard price, kept each time it changes, so a past
-- month's food cost and kitchen cost use the price of that time instead of today's.
--
-- The standard price is the one every page already reads: the newest active price
-- row of the item (created_at desc, then id). A trigger on prices writes a history
-- row whenever that changes, from any path: a price added or edited, a bill price
-- update, an import, or a recipe item's recalculated cost (its "BOM Calculation"
-- row is updated in place, so before this nothing of its past was kept).
--
-- Nothing earlier can be recovered (68 price rows had been edited in place, recipe
-- costs always were): each item starts with today's standard price, valid from the
-- beginning, which is exactly what every report used until now.

create table if not exists public.price_history (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.skus(id) on delete cascade,
  price_per_usage_uom numeric not null,
  valid_from timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists price_history_sku_valid_from on public.price_history (sku_id, valid_from desc);

alter table public.price_history enable row level security;

drop policy if exists "Signed-in users read price history" on public.price_history;
create policy "Signed-in users read price history"
  on public.price_history for select to authenticated using (true);
-- No insert/update/delete policy: only the trigger below writes (security definer)

-- Record the item's standard price if it differs from the last one recorded
create or replace function public.record_standard_price(p_sku uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now numeric;
  v_last numeric;
begin
  if p_sku is null then
    return;
  end if;
  select p.price_per_usage_uom into v_now
    from public.prices p
   where p.sku_id = p_sku and p.is_active
   order by p.created_at desc, p.id
   limit 1;
  -- No active price left: keep the last one (reports then go on using it)
  if v_now is null then
    return;
  end if;
  select h.price_per_usage_uom into v_last
    from public.price_history h
   where h.sku_id = p_sku
   order by h.valid_from desc, h.created_at desc
   limit 1;
  if v_last is distinct from v_now then
    insert into public.price_history (sku_id, price_per_usage_uom) values (p_sku, v_now);
  end if;
end;
$$;

create or replace function public.prices_record_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.record_standard_price(new.sku_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.sku_id is distinct from new.sku_id) then
    perform public.record_standard_price(old.sku_id);
  end if;
  return null;
end;
$$;

drop trigger if exists prices_record_history on public.prices;
create trigger prices_record_history
  after insert or update or delete on public.prices
  for each row execute function public.prices_record_history();

-- Starting point: today's standard price of every item, valid from the beginning
insert into public.price_history (sku_id, price_per_usage_uom, valid_from)
select distinct on (p.sku_id) p.sku_id, p.price_per_usage_uom, '2000-01-01'::timestamptz
  from public.prices p
 where p.is_active
   and not exists (select 1 from public.price_history h where h.sku_id = p.sku_id)
 order by p.sku_id, p.created_at desc, p.id;
