-- Run against a test database. Every fixture and schedule change is rolled back.
BEGIN;
DO $test$
DECLARE
  old_csp uuid := gen_random_uuid();
  recent_csp uuid := gen_random_uuid();
  fixture_runs bigint[];
  fixture_base bigint := -1000000000 - floor(random()*1000000000)::bigint * 10;
  scheduled_id bigint;
  repeated_id bigint;
BEGIN
  INSERT INTO public.csp_violations(id, reported_at)
  VALUES (old_csp, now() - interval '4 days'),
         (recent_csp, now() - interval '2 days');

  WITH inserted AS (
    INSERT INTO cron.job_run_details(runid, status, start_time, command)
    VALUES (fixture_base, 'succeeded', now() - interval '25 hours', 'retention-test'),
           (fixture_base-1, 'succeeded', now() - interval '23 hours', 'retention-test'),
           (fixture_base-2, 'failed', now() - interval '15 days', 'retention-test'),
           (fixture_base-3, 'failed', now() - interval '13 days', 'retention-test'),
           (fixture_base-4, 'running', now() - interval '30 days', 'retention-test')
    RETURNING runid
  ) SELECT array_agg(runid) INTO fixture_runs FROM inserted;

  PERFORM private.cleanup_operational_log_retention();
  IF EXISTS (SELECT 1 FROM public.csp_violations WHERE id = old_csp)
     OR NOT EXISTS (SELECT 1 FROM public.csp_violations WHERE id = recent_csp) THEN
    RAISE EXCEPTION 'CSP_RETENTION_TEST_FAILED';
  END IF;
  IF (SELECT count(*) FROM cron.job_run_details WHERE runid = ANY(fixture_runs)) <> 3
     OR EXISTS (SELECT 1 FROM cron.job_run_details WHERE runid = ANY(fixture_runs)
                AND ((status='succeeded' AND start_time < now()-interval '1 day')
                  OR (status='failed' AND start_time < now()-interval '14 days'))) THEN
    RAISE EXCEPTION 'CRON_RETENTION_TEST_FAILED';
  END IF;

  SELECT jobid INTO scheduled_id FROM cron.job WHERE jobname='spark-operational-log-retention';
  SELECT cron.schedule('spark-operational-log-retention', '* * * * *',
    'SELECT private.cleanup_operational_log_retention();') INTO repeated_id;
  IF scheduled_id IS DISTINCT FROM repeated_id
     OR (SELECT count(*) FROM cron.job WHERE jobname='spark-operational-log-retention') <> 1 THEN
    RAISE EXCEPTION 'DUPLICATE_RETENTION_JOB';
  END IF;
  IF has_function_privilege('anon', 'private.cleanup_operational_log_retention()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.cleanup_operational_log_retention()', 'EXECUTE') THEN
    RAISE EXCEPTION 'CLEANUP_EXPOSED_TO_CLIENTS';
  END IF;
END;
$test$;
SELECT 'passed: expiration, recent/active preservation, scheduler idempotence, restricted execution' AS result;
ROLLBACK;
