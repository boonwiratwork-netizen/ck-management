
-- 4. Create user_brand_assignments table for area_manager
CREATE TABLE public.user_brand_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, brand)
);

ALTER TABLE public.user_brand_assignments ENABLE ROW LEVEL SECURITY;

-- Only management can manage brand assignments
CREATE POLICY "Management can select brand assignments"
  ON public.user_brand_assignments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Management can insert brand assignments"
  ON public.user_brand_assignments FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "Management can delete brand assignments"
  ON public.user_brand_assignments FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'management'::app_role));

-- 5. Update has_role function to also check 'management' as a super-admin equivalent for old 'admin' checks
-- Update all RLS policies that reference 'admin' to also allow 'management'
-- Since we migrated admin->management, update the has_role references in RLS policies

-- Update all existing RLS policies that check for 'admin' to check 'management' instead
-- We need to drop and recreate them

-- bom_headers
DROP POLICY IF EXISTS "Admins can delete bom_headers" ON public.bom_headers;
DROP POLICY IF EXISTS "Admins can insert bom_headers" ON public.bom_headers;
DROP POLICY IF EXISTS "Admins can update bom_headers" ON public.bom_headers;
CREATE POLICY "Management can delete bom_headers" ON public.bom_headers FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert bom_headers" ON public.bom_headers FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update bom_headers" ON public.bom_headers FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- bom_lines
DROP POLICY IF EXISTS "Admins can delete bom_lines" ON public.bom_lines;
DROP POLICY IF EXISTS "Admins can insert bom_lines" ON public.bom_lines;
DROP POLICY IF EXISTS "Admins can update bom_lines" ON public.bom_lines;
CREATE POLICY "Management can delete bom_lines" ON public.bom_lines FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert bom_lines" ON public.bom_lines FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update bom_lines" ON public.bom_lines FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- bom_steps
DROP POLICY IF EXISTS "Admins can delete bom_steps" ON public.bom_steps;
DROP POLICY IF EXISTS "Admins can insert bom_steps" ON public.bom_steps;
DROP POLICY IF EXISTS "Admins can update bom_steps" ON public.bom_steps;
CREATE POLICY "Management can delete bom_steps" ON public.bom_steps FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert bom_steps" ON public.bom_steps FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update bom_steps" ON public.bom_steps FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- branches
DROP POLICY IF EXISTS "Admins can delete branches" ON public.branches;
DROP POLICY IF EXISTS "Admins can insert branches" ON public.branches;
DROP POLICY IF EXISTS "Admins can update branches" ON public.branches;
CREATE POLICY "Management can delete branches" ON public.branches FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert branches" ON public.branches FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update branches" ON public.branches FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- skus
DROP POLICY IF EXISTS "Admins can delete skus" ON public.skus;
DROP POLICY IF EXISTS "Admins can insert skus" ON public.skus;
DROP POLICY IF EXISTS "Admins can update skus" ON public.skus;
CREATE POLICY "Management can delete skus" ON public.skus FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert skus" ON public.skus FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update skus" ON public.skus FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- suppliers
DROP POLICY IF EXISTS "Admins can delete suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Admins can insert suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Admins can update suppliers" ON public.suppliers;
CREATE POLICY "Management can delete suppliers" ON public.suppliers FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert suppliers" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update suppliers" ON public.suppliers FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- prices
DROP POLICY IF EXISTS "Admins can delete prices" ON public.prices;
DROP POLICY IF EXISTS "Admins can insert prices" ON public.prices;
DROP POLICY IF EXISTS "Admins can update prices" ON public.prices;
CREATE POLICY "Management can delete prices" ON public.prices FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert prices" ON public.prices FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update prices" ON public.prices FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- menus
DROP POLICY IF EXISTS "Admins can delete menus" ON public.menus;
DROP POLICY IF EXISTS "Admins can insert menus" ON public.menus;
DROP POLICY IF EXISTS "Admins can update menus" ON public.menus;
CREATE POLICY "Management can delete menus" ON public.menus FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert menus" ON public.menus FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update menus" ON public.menus FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- menu_bom
DROP POLICY IF EXISTS "Admins can delete menu_bom" ON public.menu_bom;
DROP POLICY IF EXISTS "Admins can insert menu_bom" ON public.menu_bom;
DROP POLICY IF EXISTS "Admins can update menu_bom" ON public.menu_bom;
CREATE POLICY "Management can delete menu_bom" ON public.menu_bom FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert menu_bom" ON public.menu_bom FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update menu_bom" ON public.menu_bom FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- menu_categories
DROP POLICY IF EXISTS "Admins can delete menu_categories" ON public.menu_categories;
DROP POLICY IF EXISTS "Admins can insert menu_categories" ON public.menu_categories;
CREATE POLICY "Management can delete menu_categories" ON public.menu_categories FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert menu_categories" ON public.menu_categories FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));

-- menu_modifier_rules
DROP POLICY IF EXISTS "Admins can delete menu_modifier_rules" ON public.menu_modifier_rules;
DROP POLICY IF EXISTS "Admins can insert menu_modifier_rules" ON public.menu_modifier_rules;
DROP POLICY IF EXISTS "Admins can update menu_modifier_rules" ON public.menu_modifier_rules;
CREATE POLICY "Management can delete menu_modifier_rules" ON public.menu_modifier_rules FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert menu_modifier_rules" ON public.menu_modifier_rules FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update menu_modifier_rules" ON public.menu_modifier_rules FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- sp_bom
DROP POLICY IF EXISTS "Admins can delete sp_bom" ON public.sp_bom;
DROP POLICY IF EXISTS "Admins can insert sp_bom" ON public.sp_bom;
DROP POLICY IF EXISTS "Admins can update sp_bom" ON public.sp_bom;
CREATE POLICY "Management can delete sp_bom" ON public.sp_bom FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert sp_bom" ON public.sp_bom FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update sp_bom" ON public.sp_bom FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- profiles
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Management can insert profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update any profile" ON public.profiles FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- user_roles
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
CREATE POLICY "Management can delete roles" ON public.user_roles FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update roles" ON public.user_roles FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- Update CK operation policies: admin->management
-- goods_receipts
DROP POLICY IF EXISTS "Auth users can delete goods_receipts" ON public.goods_receipts;
DROP POLICY IF EXISTS "Auth users can insert goods_receipts" ON public.goods_receipts;
DROP POLICY IF EXISTS "Auth users can update goods_receipts" ON public.goods_receipts;
CREATE POLICY "CK users can delete goods_receipts" ON public.goods_receipts FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK users can insert goods_receipts" ON public.goods_receipts FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK users can update goods_receipts" ON public.goods_receipts FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

-- deliveries
DROP POLICY IF EXISTS "Auth users can delete deliveries" ON public.deliveries;
DROP POLICY IF EXISTS "Auth users can insert deliveries" ON public.deliveries;
DROP POLICY IF EXISTS "Auth users can update deliveries" ON public.deliveries;
CREATE POLICY "CK users can delete deliveries" ON public.deliveries FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK users can insert deliveries" ON public.deliveries FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK users can update deliveries" ON public.deliveries FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

-- production_plans
DROP POLICY IF EXISTS "Auth users can delete production_plans" ON public.production_plans;
DROP POLICY IF EXISTS "Auth users can insert production_plans" ON public.production_plans;
DROP POLICY IF EXISTS "Auth users can update production_plans" ON public.production_plans;
CREATE POLICY "CK users can delete production_plans" ON public.production_plans FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK users can insert production_plans" ON public.production_plans FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK users can update production_plans" ON public.production_plans FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

-- production_records
DROP POLICY IF EXISTS "Auth users can delete production_records" ON public.production_records;
DROP POLICY IF EXISTS "Auth users can insert production_records" ON public.production_records;
CREATE POLICY "CK users can delete production_records" ON public.production_records FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK users can insert production_records" ON public.production_records FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

-- stock_adjustments
DROP POLICY IF EXISTS "Auth users can delete stock_adjustments" ON public.stock_adjustments;
DROP POLICY IF EXISTS "Auth users can insert stock_adjustments" ON public.stock_adjustments;
CREATE POLICY "CK users can delete stock_adjustments" ON public.stock_adjustments FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK users can insert stock_adjustments" ON public.stock_adjustments FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

-- stock_count_lines
DROP POLICY IF EXISTS "Auth users can delete stock_count_lines" ON public.stock_count_lines;
DROP POLICY IF EXISTS "Auth users can insert stock_count_lines" ON public.stock_count_lines;
DROP POLICY IF EXISTS "Auth users can update stock_count_lines" ON public.stock_count_lines;
CREATE POLICY "CK users can delete stock_count_lines" ON public.stock_count_lines FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK users can insert stock_count_lines" ON public.stock_count_lines FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK users can update stock_count_lines" ON public.stock_count_lines FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

-- stock_count_sessions
DROP POLICY IF EXISTS "Auth users can delete stock_count_sessions" ON public.stock_count_sessions;
DROP POLICY IF EXISTS "Auth users can insert stock_count_sessions" ON public.stock_count_sessions;
DROP POLICY IF EXISTS "Auth users can update stock_count_sessions" ON public.stock_count_sessions;
CREATE POLICY "CK users can delete stock_count_sessions" ON public.stock_count_sessions FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK users can insert stock_count_sessions" ON public.stock_count_sessions FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK users can update stock_count_sessions" ON public.stock_count_sessions FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

-- stock_opening_balances
DROP POLICY IF EXISTS "Auth users can insert stock_opening_balances" ON public.stock_opening_balances;
DROP POLICY IF EXISTS "Auth users can update stock_opening_balances" ON public.stock_opening_balances;
CREATE POLICY "CK users can insert stock_opening_balances" ON public.stock_opening_balances FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK users can update stock_opening_balances" ON public.stock_opening_balances FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

-- branch_receipts: update admin references to management
DROP POLICY IF EXISTS "Admins can delete branch_receipts" ON public.branch_receipts;
DROP POLICY IF EXISTS "Admins can insert branch_receipts" ON public.branch_receipts;
DROP POLICY IF EXISTS "Admins can select branch_receipts" ON public.branch_receipts;
DROP POLICY IF EXISTS "Admins can update branch_receipts" ON public.branch_receipts;
CREATE POLICY "Management can delete branch_receipts" ON public.branch_receipts FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert branch_receipts" ON public.branch_receipts FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can select branch_receipts" ON public.branch_receipts FOR SELECT TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update branch_receipts" ON public.branch_receipts FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

-- branch_receipts: update branch_manager references to store_manager
DROP POLICY IF EXISTS "Branch managers can delete own branch_receipts" ON public.branch_receipts;
DROP POLICY IF EXISTS "Branch managers can insert own branch_receipts" ON public.branch_receipts;
DROP POLICY IF EXISTS "Branch managers can select own branch_receipts" ON public.branch_receipts;
DROP POLICY IF EXISTS "Branch managers can update own branch_receipts" ON public.branch_receipts;
CREATE POLICY "Store managers can delete own branch_receipts" ON public.branch_receipts FOR DELETE TO authenticated USING (has_role(auth.uid(), 'store_manager'::app_role) AND (branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())));
CREATE POLICY "Store managers can insert own branch_receipts" ON public.branch_receipts FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'store_manager'::app_role) AND (branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())));
CREATE POLICY "Store managers can select own branch_receipts" ON public.branch_receipts FOR SELECT TO authenticated USING (has_role(auth.uid(), 'store_manager'::app_role) AND (branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())));
CREATE POLICY "Store managers can update own branch_receipts" ON public.branch_receipts FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'store_manager'::app_role) AND (branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())));

-- daily_stock_counts: update admin->management, branch_manager->store_manager
DROP POLICY IF EXISTS "Admins can delete daily_stock_counts" ON public.daily_stock_counts;
DROP POLICY IF EXISTS "Admins can insert daily_stock_counts" ON public.daily_stock_counts;
DROP POLICY IF EXISTS "Admins can select daily_stock_counts" ON public.daily_stock_counts;
DROP POLICY IF EXISTS "Admins can update daily_stock_counts" ON public.daily_stock_counts;
CREATE POLICY "Management can delete daily_stock_counts" ON public.daily_stock_counts FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert daily_stock_counts" ON public.daily_stock_counts FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can select daily_stock_counts" ON public.daily_stock_counts FOR SELECT TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update daily_stock_counts" ON public.daily_stock_counts FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

DROP POLICY IF EXISTS "Branch managers can insert own daily_stock_counts" ON public.daily_stock_counts;
DROP POLICY IF EXISTS "Branch managers can select own daily_stock_counts" ON public.daily_stock_counts;
DROP POLICY IF EXISTS "Branch managers can update own daily_stock_counts" ON public.daily_stock_counts;
CREATE POLICY "Store managers can insert own daily_stock_counts" ON public.daily_stock_counts FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'store_manager'::app_role) AND (branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())));
CREATE POLICY "Store managers can select own daily_stock_counts" ON public.daily_stock_counts FOR SELECT TO authenticated USING (has_role(auth.uid(), 'store_manager'::app_role) AND (branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())));
CREATE POLICY "Store managers can update own daily_stock_counts" ON public.daily_stock_counts FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'store_manager'::app_role) AND (branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())));

-- sales_entries: update admin->management, branch_manager->store_manager
DROP POLICY IF EXISTS "Admins can delete sales_entries" ON public.sales_entries;
DROP POLICY IF EXISTS "Admins can insert sales_entries" ON public.sales_entries;
DROP POLICY IF EXISTS "Admins can update sales_entries" ON public.sales_entries;
CREATE POLICY "Management can delete sales_entries" ON public.sales_entries FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can insert sales_entries" ON public.sales_entries FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management can update sales_entries" ON public.sales_entries FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

DROP POLICY IF EXISTS "Branch managers can insert own sales" ON public.sales_entries;
DROP POLICY IF EXISTS "Branch managers can view own sales" ON public.sales_entries;
CREATE POLICY "Store managers can insert own sales" ON public.sales_entries FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'store_manager'::app_role) AND (branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())));
CREATE POLICY "Store managers can view own sales" ON public.sales_entries FOR SELECT TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR (has_role(auth.uid(), 'store_manager'::app_role) AND (branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid()))));

-- Area manager read-only policies for store data
CREATE POLICY "Area managers can view branch_receipts by brand" ON public.branch_receipts FOR SELECT TO authenticated USING (
  has_role(auth.uid(), 'area_manager'::app_role) AND branch_id IN (
    SELECT b.id FROM branches b
    JOIN user_brand_assignments uba ON uba.brand = b.brand_name
    WHERE uba.user_id = auth.uid()
  )
);

CREATE POLICY "Area managers can view daily_stock_counts by brand" ON public.daily_stock_counts FOR SELECT TO authenticated USING (
  has_role(auth.uid(), 'area_manager'::app_role) AND branch_id IN (
    SELECT b.id FROM branches b
    JOIN user_brand_assignments uba ON uba.brand = b.brand_name
    WHERE uba.user_id = auth.uid()
  )
);

CREATE POLICY "Area managers can view sales by brand" ON public.sales_entries FOR SELECT TO authenticated USING (
  has_role(auth.uid(), 'area_manager'::app_role) AND branch_id IN (
    SELECT b.id FROM branches b
    JOIN user_brand_assignments uba ON uba.brand = b.brand_name
    WHERE uba.user_id = auth.uid()
  )
);
