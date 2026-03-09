
CREATE TABLE public.menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view menu_categories" ON public.menu_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert menu_categories" ON public.menu_categories FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete menu_categories" ON public.menu_categories FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.menu_categories (name) VALUES
  ('Signature Ramen'), ('Ramen'), ('Rice Bowl'), ('Sides'), ('Drinks'), ('Dessert'), ('Other');
