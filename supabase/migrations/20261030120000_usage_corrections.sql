-- Usage corrections (Bucci, 30 Oct 2026)
-- A recorded fix to what the recipes say was used, for a branch and a date range,
-- with the reason. Food Cost adds these to standard usage and shows them; sales,
-- recipes and rules stay untouched. Deleting a row puts the numbers back.
--
-- First use: Shiro's old POS (29 Mar – 8 Oct 2026) sent the noodle choice as its own
-- line (OP-008/009/010/011) while every ramen recipe also has 1 whole-wheat noodle,
-- so noodles were counted twice. Per month: bowls with the noodle in their recipe
-- that also had a noodle line on the same bill (min of the two), worked out bill by
-- bill from sales_entries on 30 Oct 2026. Since 18 Oct Shiro uses Thaniya's POS and
-- the recipes are right (checked line by line).

create table if not exists public.usage_corrections (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  sku_id uuid not null references public.skus(id),
  date_from date not null,
  date_to date not null,
  qty numeric not null,          -- in the item's usage unit; negative = less than the recipes say
  reason text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint usage_corrections_dates check (date_to >= date_from),
  constraint usage_corrections_once unique (branch_id, sku_id, date_from, date_to, reason)
);
create index if not exists usage_corrections_lookup on public.usage_corrections (branch_id, date_from, date_to);

alter table public.usage_corrections enable row level security;
drop policy if exists "Signed-in users can view usage_corrections" on public.usage_corrections;
create policy "Signed-in users can view usage_corrections" on public.usage_corrections for select to authenticated using (true);
drop policy if exists "Management can insert usage_corrections" on public.usage_corrections;
create policy "Management can insert usage_corrections" on public.usage_corrections for insert to authenticated
  with check (has_role(auth.uid(), 'management'::app_role));
drop policy if exists "Management can delete usage_corrections" on public.usage_corrections;
create policy "Management can delete usage_corrections" on public.usage_corrections for delete to authenticated
  using (has_role(auth.uid(), 'management'::app_role));

-- Shiro, whole-wheat noodle (RM-0171), counted twice under the old POS
insert into public.usage_corrections (branch_id, sku_id, date_from, date_to, qty, reason)
select b.id, s.id, v.date_from::date, v.date_to::date, v.qty, 'POS เก่านับเส้นซ้ำ (สูตรชาม + บรรทัดตัวเลือกเส้น)'
from (values
  ('2026-03-29', '2026-03-31', -162),
  ('2026-04-01', '2026-04-30', -1345),
  ('2026-05-01', '2026-05-31', -1351),
  ('2026-06-01', '2026-06-30', -1002),
  ('2026-07-01', '2026-07-31', -686),
  ('2026-08-01', '2026-08-31', -588),
  ('2026-09-01', '2026-09-30', -469),
  ('2026-10-01', '2026-10-08', -128)
) as v(date_from, date_to, qty)
cross join public.branches b
cross join public.skus s
where b.branch_name = 'Shiro' and s.sku_id = 'RM-0171'
on conflict on constraint usage_corrections_once do nothing;
