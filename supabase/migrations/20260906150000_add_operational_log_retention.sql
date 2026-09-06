-- Keep high-volume operational telemetry bounded without changing application
-- or conference scheduler behavior.
--
-- Retention policy:
--   public.csp_violations      : 3 days
--   cron.job_run_details OK    : 1 day
--   cron.job_run_details failed: 14 days
--
-- The cleanup runs hourly. PostgreSQL autovacuum remains responsible for
-- reclaiming reusable space; VACUUM FULL is intentionally not scheduled because
-- it takes ACCESS EXCLUSIVE locks.

DO $block$
BEGIN
  IF to_regclass('public.csp_violations') IS NULL THEN
    RAISE EXCEPTION 'public.csp_violations does not exist';
  END IF;

  IF to_regclass('cron.job_run_details') IS NULL OR to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'pg_cron tables are not available';
  END IF;
END
$block$;

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

REVOKE ALL ON FUNCTION private.cleanup_operational_log_retention() FROM PUBLIC;

-- These tables are append/delete-heavy. Lower thresholds make autovacuum recycle
-- dead tuples before they accumulate into the kind of bloat observed in production.
ALTER TABLE public.csp_violations SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 50
);

ALTER TABLE cron.job_run_details SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 1000
);

-- Named scheduling is idempotent in pg_cron: applying this migration again
-- updates the same logical job instead of creating duplicate cleanup jobs.
SELECT cron.schedule(
  'spark-operational-log-retention',
  '17 * * * *',
  'SELECT private.cleanup_operational_log_retention();'
);
