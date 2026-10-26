-- The cleanup routine existed without a pg_cron job. Keep its original
-- retention windows and schedule it at the same cadence as the existing log jobs.
CREATE OR REPLACE FUNCTION private.cleanup_operational_log_retention()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM public.csp_violations
  WHERE reported_at < clock_timestamp() - INTERVAL '3 days';

  DELETE FROM cron.job_run_details
  WHERE status = 'succeeded'
    AND start_time < clock_timestamp() - INTERVAL '1 day';

  DELETE FROM cron.job_run_details
  WHERE status = 'failed'
    AND start_time < clock_timestamp() - INTERVAL '14 days';
END;
$function$;

REVOKE ALL ON FUNCTION private.cleanup_operational_log_retention() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.cleanup_operational_log_retention() TO postgres;

-- A named job is updated in place when this SQL is run again, avoiding duplicates.
SELECT cron.schedule(
  'spark-operational-log-retention',
  '* * * * *',
  'SELECT private.cleanup_operational_log_retention();'
);
