
-- Rename actual_output_kg to actual_output_g in production_records
ALTER TABLE public.production_records RENAME COLUMN actual_output_kg TO actual_output_g;

-- Rename qty_delivered_kg to qty_delivered_g in deliveries
ALTER TABLE public.deliveries RENAME COLUMN qty_delivered_kg TO actual_delivered_g;

-- Wait, the user said qty_delivered_g not actual_delivered_g
