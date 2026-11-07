-- Cost Center "ใช้ในเมนู" (where-used table, 7 Nov 2026): the kitchen manager may change
-- menu recipe lines' amount / yield, as management already can (owner's decision).
-- UPDATE only — adding or removing menu recipe lines stays management's.
-- recipe_history keeps every old version by its own trigger (security definer): nothing to add.
-- Safe to run again.

drop policy if exists "CK manager can update menu_bom" on public.menu_bom;
create policy "CK manager can update menu_bom"
  on public.menu_bom
  for update
  to authenticated
  using (public.has_role(auth.uid(), 'ck_manager'::app_role))
  with check (public.has_role(auth.uid(), 'ck_manager'::app_role));
