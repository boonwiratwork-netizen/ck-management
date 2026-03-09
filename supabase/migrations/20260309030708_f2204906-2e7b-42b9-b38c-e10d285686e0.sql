
CREATE TABLE public.sales_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  receipt_no text NOT NULL DEFAULT '',
  menu_code text NOT NULL DEFAULT '',
  menu_name text NOT NULL DEFAULT '',
  order_type text NOT NULL DEFAULT '',
  qty numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  channel text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_entries ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins can insert sales_entries" ON public.sales_entries FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update sales_entries" ON public.sales_entries FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete sales_entries" ON public.sales_entries FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- Branch managers can insert for their own branch
CREATE POLICY "Branch managers can insert own sales" ON public.sales_entries FOR INSERT TO authenticated WITH CHECK (
  has_role(auth.uid(), 'branch_manager'::app_role) AND branch_id = (SELECT branch_id FROM public.profiles WHERE user_id = auth.uid())
);

-- Branch managers can view own branch
CREATE POLICY "Branch managers can view own sales" ON public.sales_entries FOR SELECT TO authenticated USING (
  has_role(auth.uid(), 'admin'::app_role) OR (
    has_role(auth.uid(), 'branch_manager'::app_role) AND branch_id = (SELECT branch_id FROM public.profiles WHERE user_id = auth.uid())
  )
);

-- Unique constraint for duplicate check
CREATE UNIQUE INDEX sales_entries_dedup ON public.sales_entries (branch_id, sale_date, receipt_no, menu_code);
