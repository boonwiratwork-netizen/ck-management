
CREATE TABLE public.menus (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  menu_code text NOT NULL DEFAULT '' UNIQUE,
  menu_name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  selling_price numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Active',
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.menus ENABLE ROW LEVEL SECURITY;

-- Select: authenticated users can view (branch filtering done in app)
CREATE POLICY "Authenticated users can view menus"
  ON public.menus FOR SELECT TO authenticated
  USING (true);

-- Insert: admin only
CREATE POLICY "Admins can insert menus"
  ON public.menus FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Update: admin only
CREATE POLICY "Admins can update menus"
  ON public.menus FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Delete: admin only
CREATE POLICY "Admins can delete menus"
  ON public.menus FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
