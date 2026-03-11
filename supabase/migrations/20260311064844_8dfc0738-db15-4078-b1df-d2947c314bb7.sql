
-- Create bom_byproducts table
CREATE TABLE public.bom_byproducts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bom_header_id UUID NOT NULL REFERENCES public.bom_headers(id) ON DELETE CASCADE,
  sku_id UUID REFERENCES public.skus(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  output_qty NUMERIC NOT NULL DEFAULT 0,
  cost_allocation_pct NUMERIC NOT NULL DEFAULT 0,
  tracks_inventory BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bom_byproducts ENABLE ROW LEVEL SECURITY;

-- RLS policies (same pattern as bom_headers)
CREATE POLICY "Authenticated users can view bom_byproducts"
  ON public.bom_byproducts FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Management can insert bom_byproducts"
  ON public.bom_byproducts FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "Management can update bom_byproducts"
  ON public.bom_byproducts FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "Management can delete bom_byproducts"
  ON public.bom_byproducts FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'management'::app_role));
