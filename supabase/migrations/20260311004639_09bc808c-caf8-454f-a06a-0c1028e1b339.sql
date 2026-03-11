
-- 1. global_settings table
CREATE TABLE public.global_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.global_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view global_settings"
  ON public.global_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "CK users can insert global_settings"
  ON public.global_settings FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

CREATE POLICY "CK users can update global_settings"
  ON public.global_settings FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

INSERT INTO public.global_settings (key, value) VALUES ('cover_days_target', '7');

-- 2. Add cover_days_target to skus
ALTER TABLE public.skus ADD COLUMN cover_days_target numeric DEFAULT NULL;

-- 3. weekly_plan_lines table
CREATE TABLE public.weekly_plan_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL,
  sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  planned_batches numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_start, sku_id)
);

ALTER TABLE public.weekly_plan_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view weekly_plan_lines"
  ON public.weekly_plan_lines FOR SELECT TO authenticated USING (true);

CREATE POLICY "CK users can insert weekly_plan_lines"
  ON public.weekly_plan_lines FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

CREATE POLICY "CK users can update weekly_plan_lines"
  ON public.weekly_plan_lines FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));

CREATE POLICY "CK users can delete weekly_plan_lines"
  ON public.weekly_plan_lines FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));
