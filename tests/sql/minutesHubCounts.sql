-- TEST DATABASE ONLY. All fixtures, role changes and auth stubs are rolled back.
BEGIN;
SET LOCAL statement_timeout='25s';
CREATE OR REPLACE FUNCTION private.is_current_session_fully_authorized()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT coalesce(current_setting('spark.test_full',true),'')='true' $$;
DO $test$
DECLARE
  u record;
  actor uuid;
  meeting_id uuid:=gen_random_uuid();
  v_minute_id uuid:=gen_random_uuid();
  parent_id uuid:=gen_random_uuid();
  hub jsonb;
  dashboard jsonb;
  my_summary record;
  followup_summary record;
  n integer;
  open_n integer;
  closed_n integer;
  actionable integer;
  dashboards_decisions integer;
BEGIN
  SELECT user_id INTO actor FROM public.profiles ORDER BY user_id LIMIT 1;
  INSERT INTO public.meetings(id,subject,location,representative,phone,user_id)
  VALUES(meeting_id,'spark-hub-count-test','test','test','',actor);
  INSERT INTO public.minutes(id,meeting_id,meeting_title_snapshot,meeting_date_snapshot,secretary_name_snapshot,chair_name_snapshot,created_by_user_id,secretary_user_id,status,published_at,chair_confirmed_at,secretary_confirmed_at)
  VALUES(v_minute_id,meeting_id,'spark-hub-count-test','1405/08/02','test','test',actor,actor,'published',now(),now(),now());
  INSERT INTO public.minutes_decisions(id,minute_id,title,created_by_user_id,primary_owner_user_id)
  VALUES(parent_id,v_minute_id,'spark-hub-parent',actor,actor);
  INSERT INTO public.minutes_decisions(minute_id,title,created_by_user_id,primary_owner_user_id,parent_decision_id,clause_order,status,requires_followup,progress_percent,completed_at)
  VALUES(v_minute_id,'spark-hub-active',actor,actor,parent_id,1,'in_progress',true,0,null),
    (v_minute_id,'spark-hub-completed',actor,actor,parent_id,2,'completed',true,100,now()),
    (v_minute_id,'spark-hub-stopped',actor,actor,parent_id,3,'stopped',true,0,null),
    (v_minute_id,'spark-hub-unflagged',actor,actor,parent_id,4,'planned',false,0,null);
  PERFORM set_config('spark.test_full','true',true);
  FOR u IN SELECT user_id FROM public.profiles LOOP
    PERFORM set_config('request.jwt.claim.sub',u.user_id::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u.user_id,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    hub:=public.get_my_minutes_hub_counts()::jsonb;
    SELECT count(*),count(*) FILTER(WHERE status<>'published'),count(*) FILTER(WHERE status='published') INTO n,open_n,closed_n FROM public.minutes;
    IF (hub->>'minutes_total')::int<>n OR (hub->>'minutes_open')::int<>open_n OR (hub->>'minutes_closed')::int<>closed_n THEN RAISE EXCEPTION 'Hub/minutes RLS list mismatch'; END IF;
    IF (hub->>'reports_total')::int<>(public.search_minutes_report('{}'::jsonb,1,0)->>'total_count')::int THEN RAISE EXCEPTION 'Hub/report mismatch'; END IF;
    SELECT * INTO my_summary FROM public.get_my_minutes_decisions_summary();
    IF (hub->>'my_decisions_total')::int<>my_summary.total_count OR (hub->>'my_decisions_open')::int<>my_summary.active_count OR (hub->>'my_decisions_closed')::int<>my_summary.completed_count+my_summary.stopped_count THEN RAISE EXCEPTION 'Hub/my decisions mismatch'; END IF;
    SELECT * INTO followup_summary FROM public.get_trackable_minutes_decisions_summary();
    IF (hub->>'followup_total')::int<>followup_summary.total_count OR (hub->>'followup_open')::int<>followup_summary.active_count OR (hub->>'followup_closed')::int<>followup_summary.completed_count+followup_summary.stopped_count THEN RAISE EXCEPTION 'Hub/followup summary mismatch'; END IF;
    SELECT count(*) INTO actionable FROM public.get_trackable_minutes_decisions(p_status=>'active',p_requires_followup=>true,p_limit=>2147483647,p_offset=>0);
    IF (hub->>'followup_actionable')::int<>actionable OR actionable>(hub->>'followup_open')::int THEN RAISE EXCEPTION 'Hub/actionable list mismatch'; END IF;
    dashboard:=public.get_minutes_dashboard_stats();
    SELECT coalesce(sum(value::int),0) INTO dashboards_decisions FROM jsonb_each_text(dashboard->'decision_status_counts');
    IF (hub->>'dashboard_minutes_total')::int<>(dashboard->>'total_minutes')::int OR (hub->>'dashboard_minutes_closed')::int<>(dashboard->>'published')::int OR (hub->>'dashboard_minutes_open')::int<>(dashboard->>'total_minutes')::int-(dashboard->>'published')::int OR (hub->>'dashboard_decisions_total')::int<>dashboards_decisions OR (hub->>'dashboard_decisions_open')::int<>(dashboard->>'open_decisions')::int OR (hub->>'dashboard_decisions_closed')::int<>dashboards_decisions-(dashboard->>'open_decisions')::int THEN RAISE EXCEPTION 'Hub/dashboard scope mismatch'; END IF;
    IF u.user_id=actor THEN
      SELECT count(*) FILTER(WHERE id<>parent_id),count(*) FILTER(WHERE requires_followup AND status NOT IN ('completed','stopped')) INTO n,actionable FROM public.get_trackable_minutes_decisions(p_limit=>2147483647,p_offset=>0) WHERE minute_id=v_minute_id;
      IF n<>4 OR actionable<>1 THEN RAISE EXCEPTION 'Fixture hierarchy or closed followup counted incorrectly'; END IF;
    END IF;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('spark.test_full','false',true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.get_my_minutes_hub_counts();
    RAISE EXCEPTION 'Limited session allowed' USING ERRCODE='XX000';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'NOT_AUTHORIZED' THEN RAISE; END IF;
  END;
  RESET ROLE;
END;
$test$;
ROLLBACK;
SELECT 'PASS: hub counters match actual lists, summaries, reports and personal dashboard for every profile; fixtures rolled back' AS result;
