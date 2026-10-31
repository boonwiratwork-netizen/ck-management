-- Recipe history: a copy of a recipe each time it changes, so a past month's food
-- cost and kitchen cost use the recipes of that time (the companion of price_history).
--
-- kind   owner          what the copy holds
-- menu   menus.id       every menu_bom line of the menu (shared and per branch)
-- sp     skus.id (SP)   every sp_bom line of the SP item
-- sm     bom_headers.id the header, its steps and its lines
-- rules  (none)         every POS option rule with the menus it is limited to
--
-- Triggers write a copy after any change; a copy equal to the last one is skipped.
-- Copies made in one save share its time (valid_from = transaction start), and the
-- last of them (created_at = clock time) is the recipe as saved. Earlier versions
-- can't be recovered: each recipe starts with today's, valid from the beginning.

create table if not exists public.recipe_history (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('menu', 'sp', 'sm', 'rules')),
  owner_id uuid,
  snapshot jsonb not null,
  valid_from timestamptz not null default now(),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists recipe_history_owner on public.recipe_history (kind, owner_id, valid_from desc, created_at desc);

alter table public.recipe_history enable row level security;
drop policy if exists "Signed-in users read recipe history" on public.recipe_history;
create policy "Signed-in users read recipe history"
  on public.recipe_history for select to authenticated using (true);
-- Written only by the triggers below (security definer)

create or replace function public.recipe_snapshot(p_kind text, p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case p_kind
    when 'menu' then (
      select coalesce(jsonb_agg(jsonb_build_object('sku_id', b.sku_id, 'effective_qty', b.effective_qty, 'branch_id', b.branch_id) order by b.sku_id, b.branch_id, b.id), '[]'::jsonb)
        from public.menu_bom b where b.menu_id = p_owner)
    when 'sp' then (
      select coalesce(jsonb_agg(jsonb_build_object('ingredient_sku_id', s.ingredient_sku_id, 'qty_per_batch', s.qty_per_batch, 'batch_yield_qty', s.batch_yield_qty) order by s.ingredient_sku_id, s.id), '[]'::jsonb)
        from public.sp_bom s where s.sp_sku_id = p_owner)
    when 'sm' then (
      select jsonb_build_object(
        'header', (select jsonb_build_object('sm_sku_id', h.sm_sku_id, 'bom_mode', h.bom_mode, 'batch_size', h.batch_size, 'yield_percent', h.yield_percent) from public.bom_headers h where h.id = p_owner),
        'steps', (select coalesce(jsonb_agg(jsonb_build_object('id', st.id, 'step_number', st.step_number, 'yield_percent', st.yield_percent) order by st.step_number, st.id), '[]'::jsonb) from public.bom_steps st where st.bom_header_id = p_owner),
        'lines', (select coalesce(jsonb_agg(jsonb_build_object('rm_sku_id', l.rm_sku_id, 'qty_per_batch', l.qty_per_batch, 'yield_percent', l.yield_percent, 'step_id', l.step_id, 'qty_type', l.qty_type, 'percent_of_input', l.percent_of_input) order by l.rm_sku_id, l.id), '[]'::jsonb) from public.bom_lines l where l.bom_header_id = p_owner)))
    when 'rules' then (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'keyword', r.keyword, 'rule_type', r.rule_type, 'sku_id', r.sku_id, 'swap_sku_id', r.swap_sku_id,
          'submenu_id', r.submenu_id, 'qty_per_match', r.qty_per_match, 'is_active', r.is_active, 'branch_ids', r.branch_ids,
          'menu_ids', (select coalesce(jsonb_agg(m.menu_id order by m.menu_id), '[]'::jsonb) from public.modifier_rule_menus m where m.rule_id = r.id))
        order by r.id), '[]'::jsonb)
        from public.menu_modifier_rules r)
  end
$$;

create or replace function public.record_recipe(p_kind text, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now jsonb;
  v_last jsonb;
begin
  if p_kind <> 'rules' and p_owner is null then
    return;
  end if;
  v_now := public.recipe_snapshot(p_kind, p_owner);
  select h.snapshot into v_last
    from public.recipe_history h
   where h.kind = p_kind and h.owner_id is not distinct from p_owner
   order by h.valid_from desc, h.created_at desc
   limit 1;
  if v_last is distinct from v_now then
    insert into public.recipe_history (kind, owner_id, snapshot) values (p_kind, p_owner, v_now);
  end if;
end;
$$;

-- One trigger function per table: the owner(s) a changed row belongs to
create or replace function public.recipe_history_menu_bom() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'DELETE' then perform public.record_recipe('menu', new.menu_id); end if;
  if tg_op = 'DELETE' or old.menu_id is distinct from new.menu_id then perform public.record_recipe('menu', old.menu_id); end if;
  return null;
end; $$;

create or replace function public.recipe_history_sp_bom() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'DELETE' then perform public.record_recipe('sp', new.sp_sku_id); end if;
  if tg_op = 'DELETE' or old.sp_sku_id is distinct from new.sp_sku_id then perform public.record_recipe('sp', old.sp_sku_id); end if;
  return null;
end; $$;

create or replace function public.recipe_history_bom_part() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'DELETE' then perform public.record_recipe('sm', new.bom_header_id); end if;
  if tg_op = 'DELETE' or old.bom_header_id is distinct from new.bom_header_id then perform public.record_recipe('sm', old.bom_header_id); end if;
  return null;
end; $$;

create or replace function public.recipe_history_bom_header() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A deleted header takes its lines and steps with it: nothing left to copy
  if tg_op <> 'DELETE' then perform public.record_recipe('sm', new.id); end if;
  return null;
end; $$;

create or replace function public.recipe_history_rules() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_recipe('rules', null);
  return null;
end; $$;

drop trigger if exists recipe_history on public.menu_bom;
create trigger recipe_history after insert or update or delete on public.menu_bom for each row execute function public.recipe_history_menu_bom();
drop trigger if exists recipe_history on public.sp_bom;
create trigger recipe_history after insert or update or delete on public.sp_bom for each row execute function public.recipe_history_sp_bom();
drop trigger if exists recipe_history on public.bom_lines;
create trigger recipe_history after insert or update or delete on public.bom_lines for each row execute function public.recipe_history_bom_part();
drop trigger if exists recipe_history on public.bom_steps;
create trigger recipe_history after insert or update or delete on public.bom_steps for each row execute function public.recipe_history_bom_part();
drop trigger if exists recipe_history on public.bom_headers;
create trigger recipe_history after insert or update on public.bom_headers for each row execute function public.recipe_history_bom_header();
-- Rules: one copy of the whole set per statement
drop trigger if exists recipe_history on public.menu_modifier_rules;
create trigger recipe_history after insert or update or delete on public.menu_modifier_rules for each statement execute function public.recipe_history_rules();
drop trigger if exists recipe_history on public.modifier_rule_menus;
create trigger recipe_history after insert or update or delete on public.modifier_rule_menus for each statement execute function public.recipe_history_rules();

-- Starting point: today's recipes, valid from the beginning
insert into public.recipe_history (kind, owner_id, snapshot, valid_from)
select 'menu', m.id, public.recipe_snapshot('menu', m.id), '2000-01-01'::timestamptz
  from public.menus m
 where not exists (select 1 from public.recipe_history h where h.kind = 'menu' and h.owner_id = m.id);
insert into public.recipe_history (kind, owner_id, snapshot, valid_from)
select 'sp', s.id, public.recipe_snapshot('sp', s.id), '2000-01-01'::timestamptz
  from public.skus s
 where s.type = 'SP'
   and not exists (select 1 from public.recipe_history h where h.kind = 'sp' and h.owner_id = s.id);
insert into public.recipe_history (kind, owner_id, snapshot, valid_from)
select 'sm', h.id, public.recipe_snapshot('sm', h.id), '2000-01-01'::timestamptz
  from public.bom_headers h
 where not exists (select 1 from public.recipe_history x where x.kind = 'sm' and x.owner_id = h.id);
insert into public.recipe_history (kind, owner_id, snapshot, valid_from)
select 'rules', null, public.recipe_snapshot('rules', null), '2000-01-01'::timestamptz
 where not exists (select 1 from public.recipe_history h where h.kind = 'rules');
