-- Close what the security scan flagged as reachable without care (13 Nov 2026):
--
-- 1. Anyone on the internet (no login, the public "anon" key every browser has) could read
--    suppliers (contact person + phone), prices, products, menus and branches. These came
--    from "Allow Olive anon read …" (8 May 2026). This app signs in before every read, so
--    nothing in it needs them. Rollback (if Olive still needs them) is at the bottom.
-- 2. Every signed-in user (store managers too) could read suppliers' phone and contact
--    person directly, because the no-phone view (suppliers_safe) read the table as the
--    user and so needed an "everyone may read" rule. The view now reads as its owner and
--    shows only the safe columns; the table itself is for management and the kitchen.
--    Screens that only need a supplier's name / lead time read the view.

drop policy if exists "Allow Olive anon read branches" on public.branches;
drop policy if exists "Allow Olive anon read menus" on public.menus;
drop policy if exists "Allow Olive anon read skus" on public.skus;
drop policy if exists "Allow Olive anon read prices" on public.prices;
drop policy if exists "Allow Olive anon read suppliers" on public.suppliers;

-- The no-phone view: read as its owner (so it needs no open rule on the table), signed-in only
drop view if exists public.suppliers_safe;
create view public.suppliers_safe
with (security_invoker = false) as
select id, name, status, lead_time, moq, moq_unit, credit_terms, is_central_kitchen, created_at, updated_at
from public.suppliers;
revoke all on public.suppliers_safe from public, anon;
grant select on public.suppliers_safe to authenticated;

-- The table: phone and contact person for management and the kitchen only
drop policy if exists "Authenticated can view supplier rows" on public.suppliers;
-- ("Management and CK can view full suppliers" stays)

notify pgrst, 'reload schema';

-- ─── Rollback (only if something outside this app breaks) ─────────────────────
-- create policy "Allow Olive anon read branches" on public.branches for select to anon using (true);
-- create policy "Allow Olive anon read menus" on public.menus for select to anon using (true);
-- create policy "Allow Olive anon read skus" on public.skus for select to anon using (true);
-- create policy "Allow Olive anon read prices" on public.prices for select to anon using (true);
-- (suppliers stays closed to anon: give Olive the view instead if it needs names)
