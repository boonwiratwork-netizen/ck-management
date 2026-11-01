-- 1) Ask the probe (run, then wait ~5 s)
select net.http_post(
  url := 'https://lyhhaeikbvhmjpyjhdbg.supabase.co/functions/v1/foodstory-probe',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-report-key', (select decrypted_secret from vault.decrypted_secrets where name = 'report_key')),
  body := '{}'::jsonb,
  timeout_milliseconds := 30000
) as request_id;

-- 2) Read its answer
select id, status_code, content, error_msg, created
from net._http_response order by id desc limit 1;
