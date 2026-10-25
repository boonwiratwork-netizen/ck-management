-- Note on a production record (the old record form had a note box that was never stored)
alter table public.production_records add column if not exists notes text not null default '';
