ALTER TABLE public.menu_modifier_rules 
  ADD COLUMN rule_type text NOT NULL DEFAULT 'add',
  ADD COLUMN swap_sku_id uuid REFERENCES public.skus(id),
  ADD COLUMN submenu_id uuid REFERENCES public.menus(id);