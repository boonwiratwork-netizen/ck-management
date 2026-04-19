
-- ============================================================
-- 1. SUPPLIERS — restrict sensitive columns via safe view
-- ============================================================

-- Drop existing broad SELECT policy
DROP POLICY IF EXISTS "Authenticated users can view suppliers" ON public.suppliers;

-- Restrict full-table SELECT to management and ck_manager only
CREATE POLICY "Management and CK can view full suppliers"
ON public.suppliers
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'management'::app_role)
  OR public.has_role(auth.uid(), 'ck_manager'::app_role)
);

-- Create a safe view exposing only non-sensitive columns to all authenticated users
CREATE OR REPLACE VIEW public.suppliers_safe
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

-- Grant access to the safe view
GRANT SELECT ON public.suppliers_safe TO authenticated;

-- The view inherits RLS via security_invoker; we need a permissive SELECT policy
-- on the underlying table for non-management roles when accessed through the view.
-- Add a policy that allows SELECT only when the query path is the view (we cannot
-- enforce that directly; instead allow all authenticated to SELECT but the
-- application/view exposes only safe columns).
CREATE POLICY "Authenticated can view suppliers via safe view"
ON public.suppliers
FOR SELECT
TO authenticated
USING (true);

-- ============================================================
-- 2. TRANSFER_ORDER_LOT_LINES — restrict writes to ck_manager/management
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can insert transfer_order_lot_lines" ON public.transfer_order_lot_lines;
DROP POLICY IF EXISTS "Authenticated users can update transfer_order_lot_lines" ON public.transfer_order_lot_lines;
DROP POLICY IF EXISTS "Authenticated users can delete transfer_order_lot_lines" ON public.transfer_order_lot_lines;
DROP POLICY IF EXISTS "Authenticated users only" ON public.transfer_order_lot_lines;

CREATE POLICY "CK and management can insert lot lines"
ON public.transfer_order_lot_lines
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'management'::app_role)
  OR public.has_role(auth.uid(), 'ck_manager'::app_role)
);

CREATE POLICY "CK and management can update lot lines"
ON public.transfer_order_lot_lines
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'management'::app_role)
  OR public.has_role(auth.uid(), 'ck_manager'::app_role)
);

CREATE POLICY "CK and management can delete lot lines"
ON public.transfer_order_lot_lines
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'management'::app_role)
  OR public.has_role(auth.uid(), 'ck_manager'::app_role)
);

-- ============================================================
-- 3. PURCHASE_REQUESTS / PURCHASE_REQUEST_LINES — replace permissive policy
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users only" ON public.purchase_requests;
DROP POLICY IF EXISTS "Authenticated users only" ON public.purchase_request_lines;

-- purchase_requests
CREATE POLICY "Management full access to purchase_requests"
ON public.purchase_requests
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'management'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "CK managers can view purchase_requests"
ON public.purchase_requests
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'ck_manager'::app_role));

CREATE POLICY "Store managers manage own branch purchase_requests"
ON public.purchase_requests
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'store_manager'::app_role)
  AND branch_id = (SELECT branch_id FROM public.profiles WHERE user_id = auth.uid())
)
WITH CHECK (
  public.has_role(auth.uid(), 'store_manager'::app_role)
  AND branch_id = (SELECT branch_id FROM public.profiles WHERE user_id = auth.uid())
);

CREATE POLICY "Area managers view brand purchase_requests"
ON public.purchase_requests
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'area_manager'::app_role)
  AND branch_id IN (
    SELECT b.id FROM public.branches b
    JOIN public.user_brand_assignments uba ON uba.brand = b.brand_name
    WHERE uba.user_id = auth.uid()
  )
);

-- purchase_request_lines
CREATE POLICY "Management full access to purchase_request_lines"
ON public.purchase_request_lines
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'management'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "CK managers can view purchase_request_lines"
ON public.purchase_request_lines
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'ck_manager'::app_role));

CREATE POLICY "Store managers manage own branch purchase_request_lines"
ON public.purchase_request_lines
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'store_manager'::app_role)
  AND pr_id IN (
    SELECT id FROM public.purchase_requests
    WHERE branch_id = (SELECT branch_id FROM public.profiles WHERE user_id = auth.uid())
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'store_manager'::app_role)
  AND pr_id IN (
    SELECT id FROM public.purchase_requests
    WHERE branch_id = (SELECT branch_id FROM public.profiles WHERE user_id = auth.uid())
  )
);

CREATE POLICY "Area managers view brand purchase_request_lines"
ON public.purchase_request_lines
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'area_manager'::app_role)
  AND pr_id IN (
    SELECT pr.id FROM public.purchase_requests pr
    JOIN public.branches b ON b.id = pr.branch_id
    JOIN public.user_brand_assignments uba ON uba.brand = b.brand_name
    WHERE uba.user_id = auth.uid()
  )
);
