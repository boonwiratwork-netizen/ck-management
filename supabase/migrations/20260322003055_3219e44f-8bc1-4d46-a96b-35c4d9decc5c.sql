ALTER TABLE public.branch_menu_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view branch_menu_overrides"
ON public.branch_menu_overrides FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Management can insert branch_menu_overrides"
ON public.branch_menu_overrides FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "Management can update branch_menu_overrides"
ON public.branch_menu_overrides FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "Management can delete branch_menu_overrides"
ON public.branch_menu_overrides FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'management'::app_role));