-- Keep operational log retention frequent enough for the high-volume conference
-- scheduler history. Do not change the conference jobs themselves.
--
-- pg_cron accepts standard five-field cron syntax for minute-based schedules;
-- use */5 rather than an interval-like "5 minutes" string.

DO $block$
DECLARE
  v_jobid bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'pg_cron table cron.job is not available';
  END IF;

  SELECT j.jobid
  INTO v_jobid
  FROM cron.job AS j
  WHERE j.jobname = 'spark-operational-log-retention'
    AND j.username = current_user
  LIMIT 1;

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'spark-operational-log-retention',
      '*/5 * * * *',
      'SELECT private.cleanup_operational_log_retention();'
    );
  ELSE
    PERFORM cron.alter_job(
      v_jobid,
      '*/5 * * * *',
      'SELECT private.cleanup_operational_log_retention();',
      active := true
    );
  END IF;
END
$block$;
