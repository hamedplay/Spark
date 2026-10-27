-- Video conferencing is temporarily decommissioned.
-- Stop only its dedicated scheduled workers; preserve other Spark cron jobs.
-- Idempotent for deployments where some or all jobs have already been removed.
DO $$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN (
      'conference-phase-enforcer',
      'conference-speaker-timer-enforcer',
      'spark_conference_disconnect_detector',
      'spark_conference_room_cleanup'
    )
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
    RAISE NOTICE 'Disabled retired conference cron job: % (%)', v_job.jobname, v_job.jobid;
  END LOOP;
END;
$$;
