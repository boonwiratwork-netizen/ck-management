
-- Create junction table for modifier rule to menu mappings
CREATE TABLE public.modifier_rule_menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.menu_modifier_rules(id) ON DELETE CASCADE,
  menu_id uuid NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rule_id, menu_id)
);

-- Enable RLS
ALTER TABLE public.modifier_rule_menus ENABLE ROW LEVEL SECURITY;

-- RLS policies matching menu_modifier_rules patterns
CREATE POLICY "Authenticated users can view modifier_rule_menus"
  ON public.modifier_rule_menus FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Management can insert modifier_rule_menus"
  ON public.modifier_rule_menus FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "Management can delete modifier_rule_menus"
  ON public.modifier_rule_menus FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'management'::app_role));

-- Migrate existing menu_id data to the junction table
INSERT INTO public.modifier_rule_menus (rule_id, menu_id)
SELECT id, menu_id FROM public.menu_modifier_rules WHERE menu_id IS NOT NULL;
