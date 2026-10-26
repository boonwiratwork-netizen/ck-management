-- Cost Center history reads one product's changes by the ids inside each row; without
-- these it reads the whole change_log every time (slower as history grows)
create index if not exists change_log_new_sku_idx on public.change_log (table_name, (new_row->>'sku_id'));
create index if not exists change_log_old_sku_idx on public.change_log (table_name, (old_row->>'sku_id'));
create index if not exists change_log_new_header_idx on public.change_log (table_name, (new_row->>'bom_header_id'));
create index if not exists change_log_old_header_idx on public.change_log (table_name, (old_row->>'bom_header_id'));
create index if not exists change_log_new_sp_idx on public.change_log (table_name, (new_row->>'sp_sku_id'));
create index if not exists change_log_old_sp_idx on public.change_log (table_name, (old_row->>'sp_sku_id'));
