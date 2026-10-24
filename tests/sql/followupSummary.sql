-- Run against a test database as postgres. All session changes are rolled back.
-- Compare every summary field with the actual list RPC for each profile.
-- This validates counting logic, not the complete browser/session auth lifecycle.
BEGIN;
SET LOCAL statement_timeout = '25s';
DO $test$
DECLARE
  u record;
  actual record;
  expected record;
BEGIN
  FOR u IN SELECT user_id FROM public.profiles WHERE user_id IS NOT NULL LOOP
    PERFORM set_config('request.jwt.claim.sub', u.user_id::text, true);
    SELECT * INTO actual FROM public.get_trackable_minutes_decisions_summary();
    SELECT
      count(*)::integer AS total_count,
      count(*) FILTER (WHERE status IN (
        'not_started', 'planned', 'in_progress',
        'waiting_coordination', 'waiting_approval'
      ))::integer AS active_count,
      count(*) FILTER (WHERE status = 'completed')::integer AS completed_count,
      count(*) FILTER (WHERE status = 'stopped')::integer AS stopped_count,
      count(*) FILTER (WHERE overdue)::integer AS overdue_count,
      count(*) FILTER (WHERE open_obstacle_count > 0)::integer AS open_obstacle_count,
      count(*) FILTER (WHERE requires_followup)::integer AS requires_followup_count
    INTO expected
    FROM public.get_trackable_minutes_decisions(p_limit => 2147483647, p_offset => 0);
    IF to_jsonb(actual) IS DISTINCT FROM to_jsonb(expected) THEN
      RAISE EXCEPTION 'SUMMARY_LIST_MISMATCH';
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM * FROM public.get_trackable_minutes_decisions_summary();
    RAISE EXCEPTION 'UNAUTHENTICATED_CALL_NOT_REJECTED' USING ERRCODE = 'XX000';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'NOT_AUTHENTICATED' THEN RAISE; END IF;
  END;
END;
$test$;
ROLLBACK;
