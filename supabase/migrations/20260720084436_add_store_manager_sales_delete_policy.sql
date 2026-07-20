-- Allow a store_manager to delete a sales_entries row for their own branch only.
-- Mirrors the existing "Store managers can view own sales" / "Store managers can
-- insert own sales" policies' branch-scoping condition.

CREATE POLICY "Store managers can delete own sales" ON public.sales_entries
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'store_manager'::app_role)
  AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())
);
