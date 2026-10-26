-- One step, under a lock per product, for "this price is the active one": switch off
-- the item's other active prices (of the same supplier, or of every supplier when
-- p_supplier is null — recipe-made items) and make sure p_keep is on. Two people
-- saving at once used to be able to switch each other's new price off.
create or replace function public.keep_only_active_price(p_sku uuid, p_supplier uuid, p_keep uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('price:' || p_sku::text));
  update public.prices set is_active = false
   where sku_id = p_sku and is_active and id <> p_keep
     and (p_supplier is null or supplier_id = p_supplier);
  update public.prices set is_active = true where id = p_keep and not is_active;
end $$;
grant execute on function public.keep_only_active_price(uuid, uuid, uuid) to authenticated;
