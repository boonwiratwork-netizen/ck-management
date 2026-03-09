
-- Daily stock counts table
CREATE TABLE public.daily_stock_counts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  count_date DATE NOT NULL DEFAULT CURRENT_DATE,
  sku_id UUID NOT NULL REFERENCES public.skus(id),
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  received_from_ck NUMERIC NOT NULL DEFAULT 0,
  received_external NUMERIC NOT NULL DEFAULT 0,
  expected_usage NUMERIC NOT NULL DEFAULT 0,
  calculated_balance NUMERIC NOT NULL DEFAULT 0,
  physical_count NUMERIC,
  variance NUMERIC NOT NULL DEFAULT 0,
  is_submitted BOOLEAN NOT NULL DEFAULT false,
  submitted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(branch_id, count_date, sku_id)
);

-- Enable RLS
ALTER TABLE public.daily_stock_counts ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins can select daily_stock_counts" ON public.daily_stock_counts
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert daily_stock_counts" ON public.daily_stock_counts
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update daily_stock_counts" ON public.daily_stock_counts
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete daily_stock_counts" ON public.daily_stock_counts
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- Branch managers: own branch only
CREATE POLICY "Branch managers can select own daily_stock_counts" ON public.daily_stock_counts
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'branch_manager'::app_role)
    AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Branch managers can insert own daily_stock_counts" ON public.daily_stock_counts
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'branch_manager'::app_role)
    AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Branch managers can update own daily_stock_counts" ON public.daily_stock_counts
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'branch_manager'::app_role)
    AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid()));
