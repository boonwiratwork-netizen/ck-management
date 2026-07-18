-- Allow a CK manager to decline an individual transfer_request_line (e.g. when
-- there's no stock to send for it) with a reason, instead of only being able to
-- decline the whole transfer_order at the header level.

ALTER TABLE public.transfer_request_lines
  ADD COLUMN decline_reason text NULL,
  ADD COLUMN declined_at timestamptz NULL,
  ADD COLUMN declined_by uuid NULL REFERENCES public.profiles(id);
