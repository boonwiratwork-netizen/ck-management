
CREATE TABLE public.branch_receipts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  sku_id UUID NOT NULL REFERENCES public.skus(id),
  supplier_name TEXT NOT NULL DEFAULT '',
  qty_received NUMERIC NOT NULL DEFAULT 0,
  uom TEXT NOT NULL DEFAULT '',
  actual_unit_price NUMERIC NOT NULL DEFAULT 0,
  actual_total NUMERIC NOT NULL DEFAULT 0,
  std_unit_price NUMERIC NOT NULL DEFAULT 0,
  std_total NUMERIC NOT NULL DEFAULT 0,
  price_variance NUMERIC NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.branch_receipts ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins can select branch_receipts" ON public.branch_receipts FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert branch_receipts" ON public.branch_receipts FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update branch_receipts" ON public.branch_receipts FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete branch_receipts" ON public.branch_receipts FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Branch manager own branch
CREATE POLICY "Branch managers can select own branch_receipts" ON public.branch_receipts FOR SELECT TO authenticated USING (has_role(auth.uid(), 'branch_manager') AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid()));
CREATE POLICY "Branch managers can insert own branch_receipts" ON public.branch_receipts FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'branch_manager') AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid()));
CREATE POLICY "Branch managers can update own branch_receipts" ON public.branch_receipts FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'branch_manager') AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid()));
CREATE POLICY "Branch managers can delete own branch_receipts" ON public.branch_receipts FOR DELETE TO authenticated USING (has_role(auth.uid(), 'branch_manager') AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid()));
