-- Food cost by menu, per branch and month (Bucci, 31 Oct 2026)
-- The Food Cost page's "ต้นทุนตามสูตร" per menu, kept in the database so analysts can
-- read it with SQL instead of opening the page. The app writes it (management only):
-- each time it works out one branch for a whole calendar month, and from the button
-- "อัปเดตข้อมูลวิเคราะห์ทุกสาขา" (every active branch × the last 6 months that ended).
-- A month is replaced whole: new rows upserted first, then menus no longer there removed.
--
-- Sales lines whose menu isn't set up (no recipe) are kept too, with std_cost null and
-- has_recipe_cost false, so Σ revenue of a branch-month = the page's ยอดขาย.
-- Safe to run again.

create table if not exists public.food_cost_menu_monthly (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  branch_name text not null default '',
  brand_name text not null default '',
  month date not null,
  menu_code text not null,
  menu_name text not null default '',
  category text not null default '',
  qty numeric not null default 0,
  revenue numeric not null default 0,
  std_cost numeric,
  cost_per_serving numeric,
  cost_pct numeric,
  has_recipe_cost boolean not null default true,
  uncosted_qty numeric not null default 0,
  uncosted_revenue numeric not null default 0,
  is_closed_month boolean not null default false,
  computed_at timestamptz not null default now(),
  constraint food_cost_menu_monthly_first_of_month check (extract(day from month) = 1),
  constraint food_cost_menu_monthly_once unique (branch_id, month, menu_code)
);
create index if not exists food_cost_menu_monthly_month on public.food_cost_menu_monthly (month, branch_id);

alter table public.food_cost_menu_monthly enable row level security;
-- Costs of every branch: management reads them (store managers see their own on the page)
drop policy if exists "Signed-in users can view food_cost_menu_monthly" on public.food_cost_menu_monthly;
drop policy if exists "Management can view food_cost_menu_monthly" on public.food_cost_menu_monthly;
create policy "Management can view food_cost_menu_monthly" on public.food_cost_menu_monthly for select to authenticated
  using (has_role(auth.uid(), 'management'::app_role));
drop policy if exists "Management can insert food_cost_menu_monthly" on public.food_cost_menu_monthly;
create policy "Management can insert food_cost_menu_monthly" on public.food_cost_menu_monthly for insert to authenticated
  with check (has_role(auth.uid(), 'management'::app_role));
drop policy if exists "Management can update food_cost_menu_monthly" on public.food_cost_menu_monthly;
create policy "Management can update food_cost_menu_monthly" on public.food_cost_menu_monthly for update to authenticated
  using (has_role(auth.uid(), 'management'::app_role))
  with check (has_role(auth.uid(), 'management'::app_role));
drop policy if exists "Management can delete food_cost_menu_monthly" on public.food_cost_menu_monthly;
create policy "Management can delete food_cost_menu_monthly" on public.food_cost_menu_monthly for delete to authenticated
  using (has_role(auth.uid(), 'management'::app_role));

comment on table public.food_cost_menu_monthly is
  'ต้นทุนตามสูตรรายเมนู ต่อสาขา ต่อเดือน (ตัวเลขเดียวกับหน้า ต้นทุนอาหาร แท็บเมนู) — แอปเขียนเองเมื่อผู้บริหารเปิดดูสาขาเดียวทั้งเดือน หรือกดปุ่ม อัปเดตข้อมูลวิเคราะห์ทุกสาขา / Standard (recipe) food cost per menu, per branch and calendar month, as shown on the Food Cost page. Written by the app; one row per (branch_id, month, menu_code).';
comment on column public.food_cost_menu_monthly.id is 'รหัสแถว / Row id';
comment on column public.food_cost_menu_monthly.branch_id is 'สาขา (branches.id) / Branch id';
comment on column public.food_cost_menu_monthly.branch_name is 'ชื่อสาขา ณ ตอนคำนวณ / Branch name at compute time';
comment on column public.food_cost_menu_monthly.brand_name is 'แบรนด์ของสาขา ณ ตอนคำนวณ / Brand of the branch at compute time';
comment on column public.food_cost_menu_monthly.month is 'เดือน (วันที่ 1 ของเดือนเสมอ) / Month, always the 1st of the month';
comment on column public.food_cost_menu_monthly.menu_code is 'รหัสเมนูตามที่ POS ส่งมา (sales_entries.menu_code) / Menu code as sent by the POS';
comment on column public.food_cost_menu_monthly.menu_name is 'ชื่อเมนูจากรายการเมนู (ไม่มีในรายการ = ชื่อจาก POS) / Menu name from the menu list, else the POS name';
comment on column public.food_cost_menu_monthly.category is 'หมวดเมนู (ว่าง = ไม่มีในรายการเมนู) / Menu category, empty when not in the menu list';
comment on column public.food_cost_menu_monthly.qty is 'จำนวนที่ขายได้ทั้งเดือน (ทุกบรรทัดขายของรหัสนี้) / Quantity sold in the month';
comment on column public.food_cost_menu_monthly.revenue is 'ยอดขายสุทธิ หักส่วนลด ไม่รวม VAT/SC (บาท) / Net sales after discount, ex VAT and service charge (THB)';
comment on column public.food_cost_menu_monthly.std_cost is 'ต้นทุนตามสูตร (บาท): สูตรเมนู (รวมบรรทัดเฉพาะสาขา) + กระจาย SP + กฎตัวเลือกที่จับคู่กับบรรทัดขายนั้น ราคามาตรฐานของวันที่ขาย สูตรของวันที่ขาย; null = ไม่มีสูตร / Standard cost (THB): menu BOM incl. branch lines, SP expansion and every modifier rule matched to the sale line, at each sale day''s standard price and recipe; null = no recipe';
comment on column public.food_cost_menu_monthly.cost_per_serving is 'ต้นทุนตามสูตรต่อที่ = std_cost ÷ จำนวนที่มีสูตร (บาท) / Standard cost per serving (THB)';
comment on column public.food_cost_menu_monthly.cost_pct is '% ต้นทุน = std_cost ÷ ยอดขายที่มีสูตร × 100 (ยอดขาย 0 = 0) / Cost % of the costed revenue';
comment on column public.food_cost_menu_monthly.has_recipe_cost is 'true = เมนูมีสูตร คิดต้นทุนได้; false = ไม่มีในรายการเมนู ไม่มีต้นทุน (เก็บไว้ให้ยอดขายรวมตรงกับหน้าเว็บ) / false = menu not set up, no cost';
comment on column public.food_cost_menu_monthly.uncosted_qty is 'จำนวนที่ขายในวันที่รหัสนี้ยังไม่มีสูตร (ปกติ 0) / Quantity sold on days the code had no recipe (normally 0)';
comment on column public.food_cost_menu_monthly.uncosted_revenue is 'ยอดขายในวันที่รหัสนี้ยังไม่มีสูตร (ปกติ 0) / Revenue on days the code had no recipe (normally 0)';
comment on column public.food_cost_menu_monthly.is_closed_month is 'true = เดือนจบแล้วตอนคำนวณ; false = เดือนที่ยังไม่จบ ตัวเลขยังไม่ครบ / true = the month had ended when computed; false = partial month';
comment on column public.food_cost_menu_monthly.computed_at is 'เวลาที่คำนวณล่าสุด / When this row was last computed';
