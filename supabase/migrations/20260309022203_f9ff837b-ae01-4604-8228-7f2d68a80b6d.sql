
-- Create sp_bom table
CREATE TABLE public.sp_bom (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sp_sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  ingredient_sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  qty_per_batch numeric NOT NULL DEFAULT 0,
  uom text NOT NULL DEFAULT '',
  batch_yield_qty numeric NOT NULL DEFAULT 1,
  batch_yield_uom text NOT NULL DEFAULT '',
  cost_per_unit numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sp_bom ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view sp_bom" ON public.sp_bom FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert sp_bom" ON public.sp_bom FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update sp_bom" ON public.sp_bom FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete sp_bom" ON public.sp_bom FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
