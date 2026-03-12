
-- Step A: Fix unique constraint on sales_entries
-- Drop existing unique constraint (find and drop it)
DO $$
BEGIN
  -- Drop any existing unique constraint/index on (branch_id, sale_date, receipt_no, menu_code)
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'sales_entries' AND indexname = 'sales_entries_branch_id_sale_date_receipt_no_menu_code_key') THEN
    ALTER TABLE public.sales_entries DROP CONSTRAINT sales_entries_branch_id_sale_date_receipt_no_menu_code_key;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'sales_entries' AND indexname = 'sales_entries_unique_key') THEN
    DROP INDEX public.sales_entries_unique_key;
  END IF;
END $$;

-- Add new unique constraint including menu_name
ALTER TABLE public.sales_entries ADD CONSTRAINT sales_entries_branch_date_receipt_menu_key 
  UNIQUE (branch_id, sale_date, receipt_no, menu_code, menu_name);

-- Step B: Create pos_mapping_profiles table
CREATE TABLE public.pos_mapping_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  separator text NOT NULL DEFAULT 'tab',
  has_header_row boolean DEFAULT false,
  mappings jsonb NOT NULL,
  date_format text DEFAULT 'DD/MM/YYYY',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.pos_mapping_profiles ENABLE ROW LEVEL SECURITY;

-- RLS: all authenticated can read
CREATE POLICY "Authenticated users can view pos_mapping_profiles"
  ON public.pos_mapping_profiles FOR SELECT TO authenticated
  USING (true);

-- RLS: management and ck_manager can insert
CREATE POLICY "CK users can insert pos_mapping_profiles"
  ON public.pos_mapping_profiles FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

-- RLS: management and ck_manager can update
CREATE POLICY "CK users can update pos_mapping_profiles"
  ON public.pos_mapping_profiles FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

-- RLS: management and ck_manager can delete
CREATE POLICY "CK users can delete pos_mapping_profiles"
  ON public.pos_mapping_profiles FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

-- Seed default FoodStory POS profile
INSERT INTO public.pos_mapping_profiles (name, separator, has_header_row, date_format, mappings)
VALUES (
  'FoodStory POS',
  'tab',
  false,
  'DD/MM/YYYY',
  '{"date": 0, "receipt_no": 2, "menu_code": 5, "menu_name": 6, "order_type": 7, "qty": 8, "unit_price": 9, "net_amount": 13, "channel": 15}'::jsonb
);
