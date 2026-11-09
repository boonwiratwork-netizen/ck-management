-- Recipes for delivery (9 Nov 2026): ramen sold for delivery goes out with less soup and
-- tare than in the shop. Each menu recipe line may carry a second amount for delivery
-- sales; blank = the same as the shop. Sales are turned into ingredient usage with it
-- when the sale is a delivery sale (src/lib/sale-usage.ts isDeliverySale).
--
-- delivery_qty: served amount per serving, same unit as qty_per_serving and BEFORE yield
-- (the app divides by yield_pct like qty_per_serving). Null = same as the shop; 0 = the
-- item isn't used for delivery.
--
-- delivery_only (same day, design "แบบ ก" — a separate delivery recipe): a line only
-- delivery uses (the delivery box, a sauce cup). qty_per_serving / effective_qty /
-- cost_per_serving then hold the DELIVERY amount (so existing cost and quantity code has
-- a positive amount to work with) and delivery_qty stays null. Shop sales, the shop
-- recipe, its cost and the recipe sheet skip such lines; delivery sales use them.
--
-- Row security: the existing menu_bom policies are per row, not per column (management
-- writes; ck_manager may update — 20261107180000_menu_bom_ck_manager_update.sql), so
-- nothing to add.
--
-- History: recipe_snapshot('menu', …) now also keeps delivery_qty (with the line's
-- yield_pct, to turn it into a usage amount) — only on lines that have one — and
-- 'delivery_only': true — only on lines that are — so the copy
-- of a recipe without delivery amounts stays exactly as before (no extra history
-- version) and every saved copy stays valid (no key = same as the shop).
-- Safe to run again.

alter table public.menu_bom add column if not exists delivery_qty numeric null;

comment on column public.menu_bom.delivery_qty is 'Served amount per serving for a delivery sale, same unit as qty_per_serving, before yield. Null = same as the shop; 0 = not used for delivery.';

alter table public.menu_bom add column if not exists delivery_only boolean not null default false;

comment on column public.menu_bom.delivery_only is 'True = a line only delivery sales use (qty_per_serving is the delivery amount, delivery_qty null). Shop sales and the shop recipe skip it.';

alter table public.menu_bom drop constraint if exists menu_bom_delivery_qty_not_negative;
alter table public.menu_bom add constraint menu_bom_delivery_qty_not_negative check (delivery_qty is null or delivery_qty >= 0);

-- A delivery-only line has one amount: its own qty_per_serving
alter table public.menu_bom drop constraint if exists menu_bom_delivery_only_no_delivery_qty;
alter table public.menu_bom add constraint menu_bom_delivery_only_no_delivery_qty check (not delivery_only or delivery_qty is null);

-- Copied from 20261031140000_recipe_history.sql (the only definition); only the 'menu'
-- branch changes.
create or replace function public.recipe_snapshot(p_kind text, p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case p_kind
    when 'menu' then (
      select coalesce(jsonb_agg(
          jsonb_build_object('sku_id', b.sku_id, 'effective_qty', b.effective_qty, 'branch_id', b.branch_id)
          || case when b.delivery_qty is not null then jsonb_build_object('delivery_qty', b.delivery_qty, 'yield_pct', b.yield_pct) else '{}'::jsonb end
          || case when b.delivery_only then jsonb_build_object('delivery_only', true) else '{}'::jsonb end
          order by b.sku_id, b.branch_id, b.id), '[]'::jsonb)
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

-- PostgREST reads the schema at start: tell it about the new columns now
notify pgrst, 'reload schema';
