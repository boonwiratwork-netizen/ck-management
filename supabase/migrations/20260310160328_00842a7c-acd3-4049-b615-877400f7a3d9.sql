
-- Fix column name: should be qty_delivered_g not actual_delivered_g
ALTER TABLE public.deliveries RENAME COLUMN actual_delivered_g TO qty_delivered_g;

-- Multiply existing values by 1000 to convert kg → grams
UPDATE public.production_records SET actual_output_g = actual_output_g * 1000;
UPDATE public.deliveries SET qty_delivered_g = qty_delivered_g * 1000;
