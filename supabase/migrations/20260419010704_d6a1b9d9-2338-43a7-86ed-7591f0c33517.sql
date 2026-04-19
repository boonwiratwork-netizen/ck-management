
-- Remove the overly permissive policy added in the previous migration
DROP POLICY IF EXISTS "Authenticated can view suppliers via safe view" ON public.suppliers;

-- Recreate the safe view as security_definer so all authenticated users can read
-- the limited column set without bypassing the table-level restriction
DROP VIEW IF EXISTS public.suppliers_safe;

CREATE VIEW public.suppliers_safe
WITH (security_invoker = false) AS
SELECT
  id,
  name,
  status,
  lead_time,
  moq,
  moq_unit,
  credit_terms,
  is_central_kitchen,
  created_at,
  updated_at
FROM public.suppliers;

GRANT SELECT ON public.suppliers_safe TO authenticated;
