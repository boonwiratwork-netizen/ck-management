CREATE OR REPLACE FUNCTION public.validate_transfer_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN ('Draft','Sent','Received','Partially Received','Cancelled','Declined') THEN
    RAISE EXCEPTION 'Invalid transfer order status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;