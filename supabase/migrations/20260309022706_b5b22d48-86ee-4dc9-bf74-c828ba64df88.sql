
CREATE TABLE public.menu_modifier_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword text NOT NULL DEFAULT '',
  sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  qty_per_match numeric NOT NULL DEFAULT 0,
  uom text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.menu_modifier_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view menu_modifier_rules" ON public.menu_modifier_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert menu_modifier_rules" ON public.menu_modifier_rules FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update menu_modifier_rules" ON public.menu_modifier_rules FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete menu_modifier_rules" ON public.menu_modifier_rules FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
