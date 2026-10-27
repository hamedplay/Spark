BEGIN;
-- Stub secret lookup only inside this rolled-back transaction. No secret rows
-- are deleted or exposed, and the tick cannot dispatch an external request.
CREATE OR REPLACE FUNCTION private.safe_vault_secret(p_name text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT NULL::text $$;
DO $test$
DECLARE first_id bigint; second_id bigint;
BEGIN
  SELECT jobid INTO first_id FROM cron.job WHERE jobname='spark-recurring-meeting-notifications';
  ASSERT first_id IS NOT NULL,'Reminder cron missing';
  second_id:=cron.schedule('spark-recurring-meeting-notifications','* * * * *','SELECT private.run_meeting_notification_tick();');
  ASSERT first_id=second_id AND (SELECT count(*) FROM cron.job WHERE jobname='spark-recurring-meeting-notifications')=1,'Scheduler duplicated';
  PERFORM private.run_meeting_notification_tick();
  ASSERT (SELECT last_tick_at IS NOT NULL FROM private.meeting_scheduler_state WHERE singleton),'Tick not recorded';
  IF EXISTS(SELECT FROM private.meeting_notification_jobs WHERE status IN('pending','processing')) THEN
    ASSERT (SELECT dispatch_status='blocked' AND last_error='MEETING_WORKER_NOT_CONFIGURED' FROM private.meeting_scheduler_state WHERE singleton),'Missing worker not diagnosed';
  END IF;
  ASSERT NOT has_function_privilege('anon','private.run_meeting_notification_tick()','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','private.run_meeting_notification_tick()','EXECUTE');
END $test$;
SELECT 'scheduler idempotence and safe missing-worker behavior passed' AS result;
ROLLBACK;
