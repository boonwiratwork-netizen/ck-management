
-- Create sku_categories table
CREATE TABLE public.sku_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_en text NOT NULL DEFAULT '',
  name_th text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sku_categories ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view sku_categories"
  ON public.sku_categories FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Management can insert sku_categories"
  ON public.sku_categories FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "Management can update sku_categories"
  ON public.sku_categories FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "Management can delete sku_categories"
  ON public.sku_categories FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'management'::app_role));

-- Pre-populate with hardcoded categories
INSERT INTO public.sku_categories (code, name_en, name_th) VALUES
  ('MT', 'Meat', 'เนื้อสัตว์'),
  ('SF', 'Seafood', 'อาหารทะเล'),
  ('VG', 'Vegetable', 'ผัก'),
  ('FR', 'Fruit', 'ผลไม้'),
  ('DG', 'Dry Goods', 'ของแห้ง'),
  ('SC', 'Sauce', 'ซอส'),
  ('DY', 'Dairy', 'นม/ผลิตภัณฑ์นม'),
  ('OL', 'Oil', 'น้ำมัน');

-- Also insert any categories found in existing SKU data that aren't in the hardcoded list
INSERT INTO public.sku_categories (code, name_en, name_th)
SELECT DISTINCT s.category, s.category, s.category
FROM public.skus s
WHERE s.category NOT IN ('MT', 'SF', 'VG', 'FR', 'DG', 'SC', 'DY', 'OL')
  AND s.category != ''
ON CONFLICT (code) DO NOTHING;
