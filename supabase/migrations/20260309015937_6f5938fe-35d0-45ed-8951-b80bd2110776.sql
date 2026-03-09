
CREATE TABLE public.menu_bom (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id uuid NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  qty_per_serving numeric NOT NULL DEFAULT 0,
  uom text NOT NULL DEFAULT '',
  yield_pct numeric NOT NULL DEFAULT 100,
  effective_qty numeric NOT NULL DEFAULT 0,
  cost_per_serving numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.menu_bom ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view menu_bom" ON public.menu_bom FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert menu_bom" ON public.menu_bom FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update menu_bom" ON public.menu_bom FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete menu_bom" ON public.menu_bom FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
