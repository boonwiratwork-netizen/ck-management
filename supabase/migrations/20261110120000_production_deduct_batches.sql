-- Production takes raw material by the recipe batch, not by the output (Nov 2026).
-- A 30 kg recipe that came out at 33 kg used one batch of raw material, not 1.1.
-- deduct_batches = the batches of raw material a record took out of stock:
--   whole batches for a normal pot (1, 2 …), the exact share for a small batch (0.1),
--   or a count the kitchen typed by hand. Null = saved before this rule (the app then
--   reads what the record took from its tagged stock adjustments, as before).
alter table public.production_records
  add column if not exists deduct_batches numeric null;

alter table public.production_records
  drop constraint if exists production_records_deduct_batches_check;
alter table public.production_records
  add constraint production_records_deduct_batches_check check (deduct_batches is null or deduct_batches >= 0);

notify pgrst, 'reload schema';
