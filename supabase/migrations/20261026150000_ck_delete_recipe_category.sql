-- CK managers edit recipes and categories (Cost Center): they can also remove a
-- whole recipe and an unused category. Without this, deleting a recipe on the BOM
-- page removed its lines but not the recipe itself (RLS blocked it silently).
drop policy if exists "Management can delete bom_headers" on public.bom_headers;
drop policy if exists "Management or CK can delete bom_headers" on public.bom_headers;
create policy "Management or CK can delete bom_headers" on public.bom_headers for delete to authenticated
  using (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role));

drop policy if exists "Management can delete sku_categories" on public.sku_categories;
drop policy if exists "Management or CK can delete sku_categories" on public.sku_categories;
create policy "Management or CK can delete sku_categories" on public.sku_categories for delete to authenticated
  using (has_role(auth.uid(), 'management'::app_role) or has_role(auth.uid(), 'ck_manager'::app_role));
