ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS request_local_date date
  GENERATED ALWAYS AS (private.meeting_local_date(request_date)) STORED;
GRANT EXECUTE ON FUNCTION private.meeting_local_date(text) TO authenticated,service_role;
CREATE INDEX IF NOT EXISTS meetings_request_local_date_idx ON public.meetings(request_local_date);
DO $migration$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.meetings'::regclass AND conname='meetings_local_date_valid') THEN
    ALTER TABLE public.meetings ADD CONSTRAINT meetings_local_date_valid
      CHECK(request_date IS NULL OR private.meeting_local_date(request_date) IS NOT NULL);
  END IF;
END $migration$;
CREATE OR REPLACE FUNCTION private.materialize_series_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m record; r record; v_events jsonb:='[]'; v_count integer:=0;
begin
 for m in
 select t.* from public.meetings t
 where t.series_id is not null and t.status<>'closed' and t.reminder_minutes between 1 and 10080 and t.start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 and t.request_local_date between (now() at time zone 'Asia/Tehran')::date and (now() at time zone 'Asia/Tehran')::date+7
 and ((t.request_local_date+t.start_time::time) at time zone 'Asia/Tehran')>now()
 and ((t.request_local_date+t.start_time::time) at time zone 'Asia/Tehran')-make_interval(mins=>t.reminder_minutes)<=now()
 and exists(select 1 from private.meeting_recipients(to_jsonb(t)) candidate where not exists(select 1 from private.meeting_notification_jobs j where j.event_key='series-reminder:'||t.id::text||':'||md5(coalesce(t.request_date,'')||coalesce(t.start_time,'')||coalesce(t.reminder_minutes::text,''))||':'||candidate.identity))
 order by t.request_local_date,t.start_time limit 200
 loop
  for r in select * from private.meeting_recipients(to_jsonb(m)) loop
   if r.recipient_id is not null and exists(select 1 from public.meeting_inbox i where i.meeting_id=m.id and i.user_id=r.recipient_id and i.status in ('declined','pending')) then continue; end if;
   v_events:=v_events||jsonb_build_array(jsonb_build_object('series',m.series_id,'event','reminder','identity',r.identity,'recipient',r.recipient_id,'phone',r.target_phone,'audience',r.audience,'actor',m.user_id,'meeting',to_jsonb(m)));
  end loop;
  v_count:=v_count+1;
 end loop;
 perform private.queue_meeting_series_events(v_events);
 return v_count;
end $function$;

CREATE OR REPLACE FUNCTION private.get_management_today_schedule_v1(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH scoped_users AS (
    SELECT scoped_user_id AS user_id
    FROM private.get_management_scope_users_v1(p_user_id)
  ),
  scoped_today_schedule AS (
    SELECT
      m.id,
      m.subject,
      m.start_time,
      m.location,
      m.is_online,
      m.status_type
    FROM public.meetings m
    WHERE m.request_local_date IS NOT NULL
      AND m.request_local_date = (timezone('Asia/Tehran', now()))::date
      AND (
        m.user_id IN (SELECT user_id FROM scoped_users)
        OR m.meeting_manager IN (SELECT user_id FROM scoped_users)
        OR EXISTS (
          SELECT 1
          FROM scoped_users su
          WHERE su.user_id = ANY(COALESCE(m.participant_user_ids, '{}'::uuid[]))
        )
        OR EXISTS (
          SELECT 1
          FROM scoped_users su
          WHERE su.user_id = ANY(COALESCE(m.notify_users, '{}'::uuid[]))
        )
      )
    ORDER BY NULLIF(m.start_time, '')::time NULLS LAST, m.created_at
    LIMIT 8
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(sts) ORDER BY sts.start_time NULLS LAST),
    '[]'::jsonb
  )
  FROM scoped_today_schedule sts;
$function$;


CREATE TABLE IF NOT EXISTS private.meeting_scheduler_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  last_tick_at timestamptz,
  last_reminder_count integer NOT NULL DEFAULT 0,
  dispatch_status text NOT NULL DEFAULT 'not_run',
  last_error text
);
ALTER TABLE private.meeting_scheduler_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.meeting_scheduler_state FROM PUBLIC,anon,authenticated;
GRANT SELECT ON private.meeting_scheduler_state TO service_role;
INSERT INTO private.meeting_scheduler_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION private.run_meeting_notification_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_url text; v_token text; v_reminders integer;
BEGIN
  -- A missing SMS worker must not roll back successfully materialized in-app reminders.
  v_reminders:=private.materialize_series_reminders();
  DELETE FROM private.meeting_notification_jobs j WHERE j.status IN('sent','skipped','failed')
    AND j.created_at<now()-interval '90 days'
    AND NOT EXISTS(SELECT FROM jsonb_array_elements(j.meetings)e
      WHERE private.meeting_local_date(e->>'request_date')>=(now() AT TIME ZONE 'Asia/Tehran')::date);
  UPDATE private.meeting_scheduler_state SET last_tick_at=clock_timestamp(),
    last_reminder_count=v_reminders,dispatch_status='idle',last_error=NULL WHERE singleton;
  IF NOT EXISTS(SELECT FROM private.meeting_notification_jobs WHERE status IN('pending','processing')) THEN RETURN; END IF;
  v_url:=private.safe_vault_secret('meeting_notification_worker_url');
  v_token:=private.safe_vault_secret('meeting_notification_worker_token');
  IF nullif(v_url,'') IS NULL OR nullif(v_token,'') IS NULL THEN
    UPDATE private.meeting_scheduler_state SET dispatch_status='blocked',last_error='MEETING_WORKER_NOT_CONFIGURED' WHERE singleton;
    RETURN;
  END IF;
  IF v_url !~ '^https://' THEN
    UPDATE private.meeting_scheduler_state SET dispatch_status='blocked',last_error='MEETING_WORKER_URL_INVALID' WHERE singleton;
    RETURN;
  END IF;
  BEGIN
    PERFORM net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json',
      'X-Meeting-Worker-Token',v_token),body:='{}'::jsonb,timeout_milliseconds:=55000);
    UPDATE private.meeting_scheduler_state SET dispatch_status='requested' WHERE singleton;
  EXCEPTION WHEN OTHERS THEN
    UPDATE private.meeting_scheduler_state SET dispatch_status='error',last_error='WORKER_DISPATCH_FAILED:'||SQLSTATE WHERE singleton;
  END;
END $function$;
REVOKE EXECUTE ON FUNCTION private.run_meeting_notification_tick() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.run_meeting_notification_tick() TO service_role;
SELECT cron.schedule('spark-recurring-meeting-notifications','* * * * *','SELECT private.run_meeting_notification_tick();');
SELECT cron.schedule('spark-operational-log-retention','17 * * * *','SELECT private.cleanup_operational_log_retention();');
SELECT cron.schedule('spark-session-security-history-retention','23 2 * * *','SELECT private.cleanup_session_security_history();');
NOTIFY pgrst,'reload schema';
