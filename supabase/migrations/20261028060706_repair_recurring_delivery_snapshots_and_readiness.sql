-- Rebuild dispatch text from the still-valid occurrence snapshot; preserve
-- event identities, cancellation history and unknown-outcome fences.
CREATE OR REPLACE FUNCTION private.meeting_series_message_context(
 p_meetings jsonb,p_event_type text,p_recipient uuid,p_pattern text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO ''
AS $function$
DECLARE v_rows jsonb; v_first jsonb; v_last jsonb; v_count integer; v_dates text; v_summary text; v_pattern text; v_name text;
BEGIN
 SELECT jsonb_agg(e ORDER BY private.meeting_local_date(e->>'request_date'),e->>'start_time',e->>'id')
 INTO v_rows FROM jsonb_array_elements(p_meetings)e;
 v_count:=jsonb_array_length(v_rows);
 IF COALESCE(v_count,0)=0 THEN RAISE EXCEPTION 'EMPTY_MEETING_EVENT'; END IF;
 v_first:=v_rows->0; v_last:=v_rows->(v_count-1);
 v_dates:=private.format_jalali_date(private.meeting_local_date(v_first->>'request_date'));
 IF v_count>1 THEN v_dates:=v_dates||' تا '||private.format_jalali_date(private.meeting_local_date(v_last->>'request_date'))||' ('||v_count||' نوبت)'; END IF;
 v_pattern:=COALESCE(NULLIF(p_pattern,''),CASE v_first->>'repeat_type' WHEN 'weekly' THEN 'تکرار هفتگی' ELSE 'تکرار ماهانه' END);
 v_summary:=CASE p_event_type WHEN 'series_invite' THEN 'دعوت به' WHEN 'series_cancel' THEN 'لغو دعوت/جلسه'
 WHEN 'series_reminder' THEN 'یادآوری' ELSE 'تغییر برنامه' END||' «'||(v_first->>'subject')||'» | '||v_dates||
 ' | ساعت '||COALESCE(v_first->>'start_time','')||' تا '||COALESCE(v_first->>'end_time','')||' | '||COALESCE(v_first->>'location','');
 IF v_count>1 THEN v_summary:=v_summary||' | '||v_pattern||'؛ جزئیات و استثناها در تقویم اسپارک'; END IF;
 SELECT COALESCE(full_name,'همکار گرامی') INTO v_name FROM public.profiles WHERE user_id=p_recipient;
 v_name:=COALESCE(v_name,'همکار گرامی');
 RETURN jsonb_build_object('summary',v_summary,'meeting_subject',v_first->>'subject',
 'meeting_date',private.format_jalali_date(private.meeting_local_date(v_first->>'request_date')),
 'start_time',COALESCE(v_first->>'start_time',''),'end_time',COALESCE(v_first->>'end_time',''),
 'location',COALESCE(v_first->>'location',''),'full_name',v_name,'recipient_greeting',v_name||' گرامی',
 'series_id',v_first->>'series_id','occurrence_count',v_count,'series_pattern',v_pattern);
END;
$function$;
REVOKE ALL ON FUNCTION private.meeting_series_message_context(jsonb,text,uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.queue_meeting_series_events(p_events jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g record; v_first jsonb; v_last jsonb; v_dates text; v_summary text; v_event text; v_context jsonb; v_key text; v_policy private.recurring_notification_policy; v_in_app boolean; v_sms boolean; v_id uuid; v_name text;
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
  if v_in_app and g.recipient is not null then
   insert into public.notifications(user_id,title,message,type,read,sender_id,action_url,template_category,template_event_type,template_audience,event_key,metadata)
   values(g.recipient,case g.event when 'invite' then 'دعوت به جلسات تکراری' when 'cancel' then 'لغو جلسه/دعوت' when 'reminder' then 'یادآوری جلسه' else 'تغییر جلسات تکراری' end,v_summary,'meeting',false,g.actor,'calendar','meeting',v_event,g.audience,v_key||':in_app',v_context)
   on conflict(event_key) where event_key is not null do nothing;
  end if;
 end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.claim_meeting_notification_jobs(p_limit integer DEFAULT 50)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j private.meeting_notification_jobs; v_valid jsonb; v_context jsonb; v_policy private.recurring_notification_policy; v_allowed boolean;
begin
 select * into v_policy from private.recurring_notification_policy;
 -- A lost worker response may already have delivered SMS. Never blindly retry it.
 update private.meeting_notification_jobs set status='uncertain',last_error='DELIVERY_OUTCOME_UNKNOWN',processed_at=now() where status='processing' and available_at<now()-interval '5 minutes';
 for j in select * from private.meeting_notification_jobs where status='pending' and available_at<=now() order by created_at limit least(greatest(p_limit,1),100) for update skip locked loop
  v_valid:=null; v_context:=null;
  v_allowed:=case when j.event_type='series_invite' then v_policy.invite_sms when j.event_type='series_reminder' then case when j.target_phone is not null then v_policy.external_reminder_sms else v_policy.reminder_sms end else v_policy.change_sms end;
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
  update private.meeting_notification_jobs set meetings=coalesce(v_valid,j.meetings),context=coalesce(v_context,j.context),status='processing',attempts=attempts+1,available_at=now(),lease=gen_random_uuid() where id=j.id returning * into j;
  return next to_jsonb(j)-'meetings';
 end loop;
end $function$;

CREATE OR REPLACE FUNCTION private.get_recurring_notification_runtime_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
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
 'cron_active',EXISTS(SELECT FROM cron.job WHERE jobname='spark-recurring-meeting-notifications' AND active),
 'scheduler',(SELECT to_jsonb(s) FROM private.meeting_scheduler_state s WHERE singleton),'queue',v_queue);
END;
$function$;
REVOKE ALL ON FUNCTION private.get_recurring_notification_runtime_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.get_recurring_notification_runtime_status() TO authenticated;
CREATE OR REPLACE FUNCTION public.get_recurring_notification_runtime_status()
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT private.get_recurring_notification_runtime_status() $function$;
REVOKE ALL ON FUNCTION public.get_recurring_notification_runtime_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_recurring_notification_runtime_status() TO authenticated;

-- Operator-only, idempotent setup for the current deployment. Does not deploy
-- functions or invoke the worker; normal cron will use the configured endpoint.
CREATE OR REPLACE FUNCTION private.configure_meeting_notification_worker(p_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_id uuid; v_url text:=rtrim(btrim(p_url),'/'); v_token text;
BEGIN
 IF v_url IS NULL OR v_url !~ '^https://[^/?#@[:space:]]+/functions/v1/meeting-notification-worker$' THEN
  RAISE EXCEPTION 'INVALID_MEETING_WORKER_URL';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('spark.meeting-worker-config',0));
 v_token:=private.safe_vault_secret('meeting_notification_worker_token');
 IF COALESCE(length(v_token),0)<32 THEN
  SELECT id INTO v_id FROM vault.secrets WHERE name='meeting_notification_worker_token';
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  IF v_id IS NULL THEN PERFORM vault.create_secret(v_token,'meeting_notification_worker_token');
  ELSE PERFORM vault.update_secret(v_id,v_token); END IF;
 END IF;
 SELECT id INTO v_id FROM vault.secrets WHERE name='meeting_notification_worker_url';
 IF v_id IS NULL THEN PERFORM vault.create_secret(v_url,'meeting_notification_worker_url');
 ELSE PERFORM vault.update_secret(v_id,v_url); END IF;
END;
$function$;
REVOKE ALL ON FUNCTION private.configure_meeting_notification_worker(text) FROM PUBLIC,anon,authenticated,service_role;
