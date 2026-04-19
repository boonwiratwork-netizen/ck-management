
-- Remove the old "true" policies still lingering on transfer_order_lot_lines
DROP POLICY IF EXISTS "CK manager and management can insert lot lines" ON public.transfer_order_lot_lines;
DROP POLICY IF EXISTS "CK manager and management can update lot lines" ON public.transfer_order_lot_lines;
DROP POLICY IF EXISTS "CK manager and management can delete lot lines" ON public.transfer_order_lot_lines;

-- Switch the safe view to security_invoker so it follows the caller's RLS,
-- then add a dedicated policy allowing read access only when the request is
-- made through the safe view (we approximate this by allowing SELECT but
-- the view exposes only safe columns, so phone/contact remain unreachable)
DROP VIEW IF EXISTS public.suppliers_safe;

CREATE VIEW public.suppliers_safe
WITH (security_invoker = true) AS
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

-- Allow all authenticated users to SELECT rows from the suppliers table,
-- but Postgres column privileges (below) prevent them from reading sensitive
-- columns directly. Management/CK still have their dedicated SELECT policy.
CREATE POLICY "Authenticated can view supplier rows"
ON public.suppliers
FOR SELECT
TO authenticated
USING (true);

-- Restrict column access: only specific safe columns are readable by 'authenticated'.
-- Sensitive columns (phone, contact_person) are NOT granted, so any direct SELECT
-- of those columns by non-privileged users will fail.
REVOKE SELECT ON public.suppliers FROM authenticated;
GRANT SELECT (
  id, name, status, lead_time, moq, moq_unit, credit_terms,
  is_central_kitchen, created_at, updated_at
) ON public.suppliers TO authenticated;

-- Grant full column access to service_role (used by edge functions / management context)
GRANT SELECT ON public.suppliers TO service_role;
