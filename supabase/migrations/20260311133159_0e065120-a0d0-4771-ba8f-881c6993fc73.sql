CREATE POLICY "CK users can update production_records"
ON public.production_records
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role));