-- Connect durable recurring jobs to immediate authenticated dispatch and the
-- existing notification scheduler. Channel identities/leases stay independent.
ALTER TABLE private.meeting_notification_jobs ADD COLUMN channel text NOT NULL DEFAULT 'sms' CHECK(channel IN('sms','bale'));
ALTER TABLE private.meeting_notification_jobs ADD CONSTRAINT meeting_bale_recipient_required CHECK(channel<>'bale' OR recipient_id IS NOT NULL);
CREATE INDEX meeting_delivery_actor_series_pending ON private.meeting_notification_jobs(actor_id,series_id,created_at) WHERE status='pending';
ALTER TABLE private.meeting_scheduler_state ADD COLUMN last_delivery_run_at timestamptz, ADD COLUMN last_background_delivery_at timestamptz, ADD COLUMN last_delivery_processed integer;

CREATE OR REPLACE FUNCTION private.queue_meeting_series_events(p_events jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g record; v_first jsonb; v_last jsonb; v_dates text; v_summary text; v_event text; v_context jsonb; v_key text; v_policy private.recurring_notification_policy; v_in_app boolean; v_sms boolean; v_id uuid; v_name text; v_rendered jsonb;
begin
 select * into v_policy from private.recurring_notification_policy;
 for g in
 select e->>'series' series,e->>'event' event,e->>'identity' identity,(e->>'recipient')::uuid recipient,e->>'phone' phone,min(e->>'audience') audience,(e->>'actor')::uuid actor,
 jsonb_agg(e->'meeting' order by e->'meeting'->>'request_date') meetings
 from jsonb_array_elements(p_events) e group by e->>'series',e->>'event',e->>'identity',e->>'recipient',e->>'phone',e->>'actor',case when e->>'event'='reminder' then e->'meeting'->>'id' else null end
 loop
  v_first:=g.meetings->0;
  v_event:='series_'||g.event;
  v_context:=private.meeting_series_message_context(g.meetings,v_event,g.recipient,nullif(current_setting('spark.series_pattern',true),''));
  v_summary:=v_context->>'summary';
  v_in_app:=case when g.event='invite' then v_policy.invite_in_app when g.event='reminder' then v_policy.reminder_in_app else v_policy.change_in_app end;
  v_sms:=case when g.event='invite' then v_policy.invite_sms when g.event='reminder' then case when g.phone is not null then v_policy.external_reminder_sms else v_policy.reminder_sms end else v_policy.change_sms end;
  -- Existing per-meeting external SMS opt-in remains authoritative.
  if g.phone is not null then v_sms:=v_sms and coalesce((v_first->>'send_sms')::boolean,false); end if;
  v_key:='series:'||g.series||':'||g.event||':'||txid_current()::text||':'||g.identity;
  if g.event='reminder' then v_key:='series-reminder:'||(v_first->>'id')||':'||md5(coalesce(v_first->>'request_date','')||coalesce(v_first->>'start_time','')||coalesce(v_first->>'reminder_minutes',''))||':'||g.identity; end if;
  insert into private.meeting_notification_jobs(event_key,series_id,event_type,audience,recipient_id,target_phone,actor_id,meetings,context,status)
  values(v_key,g.series::uuid,v_event,g.audience,g.recipient,g.phone,g.actor,g.meetings,v_context,case when v_sms then 'pending' else 'skipped' end)
  on conflict(event_key) do nothing returning id into v_id;
  if v_id is null then continue; end if;
  if v_in_app and g.recipient is not null and exists(
   select from public.notification_templates where category='meeting' and event_type=v_event
   and audience in(g.audience,'all') and is_active) then
   v_rendered:=private.render_notification_template('meeting',v_event,g.audience,v_context);
   insert into public.notifications(user_id,title,message,type,read,sender_id,action_url,template_id,template_category,template_event_type,template_audience,event_key,metadata)
   values(g.recipient,v_rendered->>'title',v_rendered->>'message','meeting',false,g.actor,'calendar',(v_rendered->>'template_id')::uuid,'meeting',v_event,g.audience,v_key||':in_app',v_context)
   on conflict(event_key) where event_key is not null do nothing;
   INSERT INTO private.meeting_notification_jobs(event_key,series_id,event_type,audience,recipient_id,actor_id,meetings,context,status,channel)
   VALUES(v_key||':bale',g.series::uuid,v_event,g.audience,g.recipient,g.actor,g.meetings,
    v_context||jsonb_build_object('notification_title',v_rendered->>'title','notification_message',v_rendered->>'message'),'pending','bale')
   ON CONFLICT(event_key) DO NOTHING;
  end if;
 end loop;
end $function$;

CREATE OR REPLACE FUNCTION private.claim_meeting_delivery_jobs(p_limit integer, p_actor_id uuid DEFAULT NULL, p_series_id uuid DEFAULT NULL, p_channel text DEFAULT NULL)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j private.meeting_notification_jobs; v_valid jsonb; v_context jsonb; v_policy private.recurring_notification_policy; v_allowed boolean; v_rendered jsonb;
begin
 select * into v_policy from private.recurring_notification_policy;
 -- A lost worker response may already have delivered SMS. Never blindly retry it.
 update private.meeting_notification_jobs set status='uncertain',last_error='DELIVERY_OUTCOME_UNKNOWN',processed_at=now() where status='processing' and available_at<now()-interval '5 minutes' AND (p_actor_id IS NULL OR actor_id=p_actor_id) AND (p_series_id IS NULL OR series_id=p_series_id) AND (p_channel IS NULL OR channel=p_channel);
 for j in select * from private.meeting_notification_jobs where status='pending' and available_at<=now() AND (p_actor_id IS NULL OR actor_id=p_actor_id) AND (p_series_id IS NULL OR series_id=p_series_id) AND (p_channel IS NULL OR channel=p_channel) order by created_at limit least(greatest(p_limit,1),100) for update skip locked loop
  v_valid:=null; v_context:=null;
  v_allowed:=case when j.channel='bale' then case j.event_type when 'series_invite' then v_policy.invite_in_app when 'series_reminder' then v_policy.reminder_in_app else v_policy.change_in_app end when j.event_type='series_invite' then v_policy.invite_sms when j.event_type='series_reminder' then case when j.target_phone is not null then v_policy.external_reminder_sms else v_policy.reminder_sms end else v_policy.change_sms end;
  if j.event_type<>'series_cancel' then
   select jsonb_agg(to_jsonb(m) order by m.request_local_date,m.start_time,m.id) into v_valid from jsonb_array_elements(j.meetings) e join public.meetings m on m.id=(e->>'id')::uuid
   where m.series_id=j.series_id and m.status<>'closed' and exists(select 1 from private.meeting_recipients(to_jsonb(m)) r where r.recipient_id=j.recipient_id or r.target_phone=j.target_phone)
   and (m.request_local_date,m.start_time,m.end_time,m.location,m.subject,m.is_online,m.conference_room_id) is not distinct from (private.meeting_local_date(e->>'request_date'),e->>'start_time',e->>'end_time',e->>'location',e->>'subject',(e->>'is_online')::boolean,nullif(e->>'conference_room_id','')::uuid)
   and (j.target_phone is null or coalesce(m.send_sms,false))
   and (j.event_type<>'series_reminder' or not exists(select 1 from public.meeting_inbox i where i.meeting_id=m.id and i.user_id=j.recipient_id and i.status in ('pending','declined')))
   and (j.event_type<>'series_reminder' or ((private.meeting_local_date(m.request_date)+m.start_time::time) at time zone 'Asia/Tehran')>now());
   if v_valid is null then v_allowed:=false; end if;
  end if;
  if not v_allowed then update private.meeting_notification_jobs set status='skipped',processed_at=now(),last_error='POLICY_DISABLED_OR_EVENT_SUPERSEDED' where id=j.id; continue; end if;
  if v_valid is not null then v_context:=private.meeting_series_message_context(v_valid,j.event_type,j.recipient_id,j.context->>'series_pattern'); end if;
  IF j.channel='bale' AND j.event_type<>'series_cancel' THEN
   IF NOT EXISTS(SELECT FROM public.notification_templates WHERE category='meeting' AND event_type=j.event_type AND audience IN(j.audience,'all') AND is_active) THEN
    UPDATE private.meeting_notification_jobs SET status='skipped',processed_at=now(),last_error='NOTIFICATION_TEMPLATE_DISABLED' WHERE id=j.id; CONTINUE;
   END IF;
   v_rendered:=private.render_notification_template('meeting',j.event_type,j.audience,coalesce(v_context,j.context));
   v_context:=coalesce(v_context,j.context)||jsonb_build_object('notification_title',v_rendered->>'title','notification_message',v_rendered->>'message');
  END IF;
  update private.meeting_notification_jobs set meetings=coalesce(v_valid,j.meetings),context=coalesce(v_context,j.context),status='processing',attempts=attempts+1,available_at=now(),lease=gen_random_uuid() where id=j.id returning * into j;
  return next to_jsonb(j)-'meetings';
 end loop;
end $function$;

REVOKE ALL ON FUNCTION private.claim_meeting_delivery_jobs(integer,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.claim_meeting_notification_jobs(p_limit integer DEFAULT 50)
RETURNS SETOF jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $function$
 SELECT * FROM private.claim_meeting_delivery_jobs(p_limit,NULL,NULL,'sms');
$function$;
REVOKE ALL ON FUNCTION public.claim_meeting_notification_jobs(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_meeting_notification_jobs(integer) TO service_role;
-- Old workers only receive SMS rows; a staged rollout cannot turn Bale jobs
-- into duplicate SMS sends. New workers use the multichannel claim explicitly.
CREATE OR REPLACE FUNCTION public.claim_recurring_delivery_jobs(p_limit integer DEFAULT 25)
RETURNS SETOF jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $function$
 SELECT * FROM private.claim_meeting_delivery_jobs(p_limit,NULL,NULL,NULL);
$function$;
REVOKE ALL ON FUNCTION public.claim_recurring_delivery_jobs(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recurring_delivery_jobs(integer) TO service_role;
CREATE OR REPLACE FUNCTION public.claim_actor_meeting_notification_jobs(p_actor_id uuid,p_series_id uuid,p_limit integer DEFAULT 25)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
 IF p_actor_id IS NULL OR p_series_id IS NULL THEN RAISE EXCEPTION 'ACTOR_AND_SERIES_REQUIRED'; END IF;
 RETURN QUERY SELECT * FROM private.claim_meeting_delivery_jobs(p_limit,p_actor_id,p_series_id,NULL);
END $function$;
REVOKE ALL ON FUNCTION public.claim_actor_meeting_notification_jobs(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_actor_meeting_notification_jobs(uuid,uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_meeting_notification_jobs()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path='' AS $function$
 SELECT private.materialize_series_reminders();
$function$;
REVOKE ALL ON FUNCTION public.prepare_meeting_notification_jobs() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_meeting_notification_jobs() TO service_role;
CREATE OR REPLACE FUNCTION public.record_meeting_delivery_run(p_processed integer,p_background boolean DEFAULT false)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $function$
 UPDATE private.meeting_scheduler_state SET last_delivery_run_at=clock_timestamp(),
 last_delivery_processed=greatest(p_processed,0),
 last_background_delivery_at=CASE WHEN p_background THEN clock_timestamp() ELSE last_background_delivery_at END WHERE singleton;
$function$;
REVOKE ALL ON FUNCTION public.record_meeting_delivery_run(integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_meeting_delivery_run(integer,boolean) TO service_role;
CREATE OR REPLACE FUNCTION private.run_meeting_notification_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    IF EXISTS(SELECT FROM private.meeting_scheduler_state WHERE singleton AND last_background_delivery_at>now()-interval '3 minutes') THEN
      UPDATE private.meeting_scheduler_state SET dispatch_status='existing_sender_active',last_error=NULL WHERE singleton;
      RETURN;
    END IF;
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

CREATE OR REPLACE FUNCTION private.get_recurring_notification_runtime_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_url text; v_token text; v_queue jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_current_session_fully_authorized() OR NOT private.is_current_user_admin() THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 v_url:=private.safe_vault_secret('meeting_notification_worker_url');
 v_token:=private.safe_vault_secret('meeting_notification_worker_token');
 SELECT COALESCE(jsonb_object_agg(status,n),'{}'::jsonb) INTO v_queue FROM
 (SELECT status,count(*) n FROM private.meeting_notification_jobs GROUP BY status)s;
 RETURN jsonb_build_object('worker_configured',COALESCE(v_url ~ '^https://',false) AND COALESCE(length(v_token)>=32,false),
 'existing_sender_active',EXISTS(SELECT FROM private.meeting_scheduler_state WHERE singleton AND last_background_delivery_at>now()-interval '3 minutes'),
 'queue_by_channel',(SELECT coalesce(jsonb_object_agg(channel,counts),'{}'::jsonb) FROM
 (SELECT channel,jsonb_object_agg(status,n) counts FROM (SELECT channel,status,count(*) n FROM private.meeting_notification_jobs GROUP BY channel,status)x GROUP BY channel)y),
 'cron_active',EXISTS(SELECT FROM cron.job WHERE jobname='spark-recurring-meeting-notifications' AND active),
 'scheduler',(SELECT to_jsonb(s) FROM private.meeting_scheduler_state s WHERE singleton),'queue',v_queue);
END;
$function$;

NOTIFY pgrst,'reload schema';
