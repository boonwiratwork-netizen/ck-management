-- Two permission additions, both scoped to the user's own branch for
-- store_manager, matching every other store_manager policy in this schema:
--
-- 1. daily_stock_counts: allow deleting a row, but ONLY while it is still
--    unsubmitted (is_submitted = false). This table is the ground-truth
--    physical-count anchor that nearly every stock formula in the app reads —
--    once a sheet is submitted it must never be deletable, by anyone,
--    to protect that anchor. Management's existing (unrestricted) delete
--    policy is replaced with the same unsubmitted-only restriction.
--
-- 2. sales_entries: allow store_manager to update their own branch's rows
--    (management can already update any row via the existing
--    "Management can update sales_entries" policy — no change needed there).

DROP POLICY IF EXISTS "Management can delete daily_stock_counts" ON public.daily_stock_counts;

CREATE POLICY "Management can delete unsubmitted daily_stock_counts" ON public.daily_stock_counts
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'management'::app_role)
  AND is_submitted = false
);

CREATE POLICY "Store managers can delete own unsubmitted daily_stock_counts" ON public.daily_stock_counts
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'store_manager'::app_role)
  AND is_submitted = false
  AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())
);

CREATE POLICY "Store managers can update own sales" ON public.sales_entries
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'store_manager'::app_role)
  AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())
);
