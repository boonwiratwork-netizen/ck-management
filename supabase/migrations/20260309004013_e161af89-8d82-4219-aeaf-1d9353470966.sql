-- Create branches table
CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_name text NOT NULL DEFAULT '',
  brand_name text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view branches"
  ON public.branches FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can insert branches"
  ON public.branches FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update branches"
  ON public.branches FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete branches"
  ON public.branches FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Add branch_manager to enum
ALTER TYPE public.app_role ADD VALUE 'branch_manager';

-- Add branch_id to profiles (nullable)
ALTER TABLE public.profiles ADD COLUMN branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;