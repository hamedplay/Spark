-- Only recurring delivery/template routes. Preserve custom templates and policies.
WITH defaults(event_type,title,body) AS (VALUES
 ('series_invite','دعوت به جلسات تکراری «{{meeting_subject}}»',E'{{recipient_greeting}}\nشما به جلسات تکرارشونده «{{meeting_subject}}» دعوت شده‌اید.\nاز {{series_start_date}} تا {{series_end_date}}، {{occurrence_count}} نوبت\nساعت {{meeting_time}}{{location_part}}\n{{series_pattern}}\nجزئیات و استثناها در تقویم اسپارک'),
 ('series_change','تغییر جلسات تکراری «{{meeting_subject}}»',E'{{recipient_greeting}}\nبرنامه جلسات «{{meeting_subject}}» تغییر کرده است.\nنوبت‌های مرتبط: {{series_start_date}} تا {{series_end_date}}، {{occurrence_count}} نوبت\nساعت {{meeting_time}}{{location_part}}\nجزئیات و استثناها در تقویم اسپارک'),
 ('series_cancel','لغو جلسه/دعوت «{{meeting_subject}}»',E'{{recipient_greeting}}\nجلسه یا دعوت شما به «{{meeting_subject}}» برای نوبت‌های زیر لغو شده است:\n{{series_start_date}} تا {{series_end_date}}، {{occurrence_count}} نوبت\nساعت {{meeting_time}}{{location_part}}'),
 ('series_reminder','یادآوری جلسه «{{meeting_subject}}»',E'{{recipient_greeting}}\nیادآوری جلسه «{{meeting_subject}}»\nتاریخ {{meeting_date}}، ساعت {{meeting_time}}{{location_part}}')
)
INSERT INTO public.notification_templates(category,event_type,audience,title,body,placeholders)
SELECT 'meeting',event_type,'all',title,body,ARRAY['recipient_greeting','meeting_subject','series_start_date','series_end_date','occurrence_count','meeting_time','location_part','series_pattern','meeting_date'] FROM defaults
ON CONFLICT(category,event_type,audience) DO NOTHING;

-- Replace only the old shipped summary-only/empty SMS bodies.
INSERT INTO public.sms_templates(category,event_type,audience,subject,body,placeholders)
SELECT category,event_type,audience,title,body,placeholders FROM public.notification_templates
WHERE category='meeting' AND event_type IN('series_invite','series_change','series_cancel','series_reminder') AND audience='all'
ON CONFLICT(category,event_type,audience) DO UPDATE
SET body=EXCLUDED.body,placeholders=EXCLUDED.placeholders,updated_at=now()
WHERE btrim(public.sms_templates.body) IN('','{{summary}}');

CREATE OR REPLACE FUNCTION private.meeting_series_message_context(p_meetings jsonb, p_event_type text, p_recipient uuid, p_pattern text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
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
 'series_id',v_first->>'series_id','occurrence_count',v_count,'series_pattern',v_pattern,
 'series_start_date',replace(private.format_jalali_date(private.meeting_local_date(v_first->>'request_date')),'-','/'),
 'series_end_date',replace(private.format_jalali_date(private.meeting_local_date(v_last->>'request_date')),'-','/'),
 'meeting_time',COALESCE(v_first->>'start_time','')||' تا '||COALESCE(v_first->>'end_time',''),
 'location_part',CASE WHEN nullif(v_first->>'location','') IS NULL THEN '' ELSE ' | '||(v_first->>'location') END);
END;
$function$;

-- Pending jobs created before these placeholders existed must remain renderable.
UPDATE private.meeting_notification_jobs j
SET context=j.context||private.meeting_series_message_context(j.meetings,j.event_type,j.recipient_id,j.context->>'series_pattern')
WHERE j.status='pending' AND jsonb_array_length(j.meetings)>0;

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
  end if;
 end loop;
end $function$;

-- This admin command stores only this deployment's HTTPS origin and retains the
-- dedicated Vault token. It returns no URL, service credential or Vault secret.
CREATE OR REPLACE FUNCTION private.configure_recurring_notification_delivery(p_origin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_origin text:=rtrim(btrim(p_origin),'/');
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_current_session_fully_authorized()
  OR NOT private.is_current_user_admin() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF v_origin IS NULL OR v_origin !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?$' THEN
  RAISE EXCEPTION 'INVALID_DEPLOYMENT_ORIGIN';
 END IF;
 PERFORM private.configure_meeting_notification_worker(v_origin||'/functions/v1/meeting-notification-worker');
 PERFORM cron.schedule('spark-recurring-meeting-notifications','* * * * *','SELECT private.run_meeting_notification_tick();');
 RETURN private.get_recurring_notification_runtime_status();
END $function$;
REVOKE ALL ON FUNCTION private.configure_recurring_notification_delivery(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.configure_recurring_notification_delivery(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.configure_recurring_notification_delivery(p_origin text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.configure_recurring_notification_delivery(p_origin); $function$;
REVOKE ALL ON FUNCTION public.configure_recurring_notification_delivery(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.configure_recurring_notification_delivery(text) TO authenticated;
NOTIFY pgrst,'reload schema';
