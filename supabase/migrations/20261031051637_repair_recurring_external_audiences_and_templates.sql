-- Route all five recurring meeting audiences through the existing sender.
-- Recurring policy controls invitations/changes/reminders for internal and external
-- audiences. Reminder SMS defaults and legacy non-recurring behavior are retained.
-- No historical sent/skipped/uncertain job is reset or replayed.
CREATE OR REPLACE FUNCTION private.meeting_recipients(p_meeting jsonb)
RETURNS TABLE(identity text,recipient_id uuid,target_phone text,audience text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $recipients$
 WITH internal AS (
  SELECT DISTINCT u::uuid id,
   CASE WHEN u=p_meeting->>'user_id' THEN 'creator'
    WHEN (p_meeting->'participant_user_ids') ? u THEN 'participants' ELSE 'observers' END audience
  FROM jsonb_array_elements_text(
   coalesce(nullif(p_meeting->'participant_user_ids','null'::jsonb),'[]')||
   coalesce(nullif(p_meeting->'notify_users','null'::jsonb),'[]')||jsonb_build_array(p_meeting->>'user_id')) u
 ), external AS (
  SELECT private.meeting_phone(c.phone) phone,
   CASE WHEN bool_or(coalesce(p_meeting->'external_participants','[]') ? c.name)
    THEN 'external' ELSE 'external_observers' END audience
  FROM public.contacts_email c
  WHERE c.user_id=(p_meeting->>'user_id')::uuid
   AND (coalesce(p_meeting->'external_participants','[]') ? c.name
    OR coalesce(p_meeting->'external_informees','[]') ? c.name)
  GROUP BY private.meeting_phone(c.phone)
 )
 SELECT 'user:'||id::text,id,null::text,audience FROM internal WHERE id IS NOT NULL
 UNION ALL
 SELECT 'phone:'||phone,null::uuid,phone,audience FROM external
 WHERE length(phone)>=7 AND NOT EXISTS(
  SELECT FROM internal i JOIN public.profiles p ON p.user_id=i.id
  WHERE private.meeting_phone(p.phone)=external.phone);
$recipients$;

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
  if g.phone is not null then
   select c.name into v_name from public.contacts_email c
   where c.user_id=(v_first->>'user_id')::uuid and private.meeting_phone(c.phone)=g.phone
    and (coalesce(v_first->'external_participants','[]') ? c.name or coalesce(v_first->'external_informees','[]') ? c.name)
   order by case when coalesce(v_first->'external_participants','[]') ? c.name then 0 else 1 end,c.id limit 1;
   if nullif(btrim(v_name),'') is not null then
    v_context:=v_context||jsonb_build_object('full_name',v_name,'recipient_greeting',v_name||' گرامی','formal_recipient_greeting',v_name||' گرامی');
   end if;
  end if;
  v_summary:=v_context->>'summary';
  v_in_app:=case when g.event='invite' then v_policy.invite_in_app when g.event='reminder' then v_policy.reminder_in_app else v_policy.change_in_app end;
  v_sms:=case when g.event='invite' then v_policy.invite_sms when g.event='reminder' then case when g.phone is not null then v_policy.external_reminder_sms else v_policy.reminder_sms end else v_policy.change_sms end;
  -- Recurring delivery uses the dedicated series policy for every audience.
  -- send_sms is a legacy single-meeting flag and is false in the request form.
  v_key:='series:'||g.series||':'||g.event||':'||txid_current()::text||':'||g.identity;
  if g.event='reminder' then v_key:='series-reminder:'||(v_first->>'id')||':'||md5(coalesce(v_first->>'request_date','')||coalesce(v_first->>'start_time','')||coalesce(v_first->>'reminder_minutes',''))||':'||g.identity; end if;
  insert into private.meeting_notification_jobs(event_key,series_id,event_type,audience,recipient_id,target_phone,actor_id,meetings,context,status)
  values(v_key,g.series::uuid,v_event,g.audience,g.recipient,g.phone,coalesce(auth.uid(),g.actor),g.meetings,v_context,case when v_sms then 'pending' else 'skipped' end)
  on conflict(event_key) do nothing returning id into v_id;
  if v_id is null then continue; end if;
  if v_in_app and g.recipient is not null and exists(
   select from public.notification_templates where category='meeting' and event_type=v_event
   and audience in(g.audience,'all') and is_active) then
   v_rendered:=private.render_notification_template('meeting',v_event,g.audience,v_context);
   insert into public.notifications(user_id,title,message,type,read,sender_id,action_url,template_id,template_category,template_event_type,template_audience,event_key,metadata)
   values(g.recipient,v_rendered->>'title',v_rendered->>'message','meeting',false,coalesce(auth.uid(),g.actor),'calendar',(v_rendered->>'template_id')::uuid,'meeting',v_event,g.audience,v_key||':in_app',v_context)
   on conflict(event_key) where event_key is not null do nothing;
   INSERT INTO private.meeting_notification_jobs(event_key,series_id,event_type,audience,recipient_id,actor_id,meetings,context,status,channel)
   VALUES(v_key||':bale',g.series::uuid,v_event,g.audience,g.recipient,coalesce(auth.uid(),g.actor),g.meetings,
    v_context||jsonb_build_object('notification_title',v_rendered->>'title','notification_message',v_rendered->>'message'),'pending','bale')
   ON CONFLICT(event_key) DO NOTHING;
  end if;
 end loop;
end $function$;
CREATE OR REPLACE FUNCTION private.claim_meeting_delivery_jobs(p_limit integer, p_actor_id uuid DEFAULT NULL::uuid, p_series_id uuid DEFAULT NULL::uuid, p_channel text DEFAULT NULL::text)
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
   and (j.event_type<>'series_reminder' or not exists(select 1 from public.meeting_inbox i where i.meeting_id=m.id and i.user_id=j.recipient_id and i.status in ('pending','declined')))
   and (j.event_type<>'series_reminder' or ((private.meeting_local_date(m.request_date)+m.start_time::time) at time zone 'Asia/Tehran')>now());
   if v_valid is null then v_allowed:=false; end if;
  end if;
  if not v_allowed then update private.meeting_notification_jobs set status='skipped',processed_at=now(),last_error='POLICY_DISABLED_OR_EVENT_SUPERSEDED' where id=j.id; continue; end if;
  if v_valid is not null then v_context:=private.meeting_series_message_context(v_valid,j.event_type,j.recipient_id,j.context->>'series_pattern'); end if;
  -- Keep the external recipient name from the event snapshot when refreshing dates.
  if j.target_phone is not null and v_context is not null then
   v_context:=v_context||jsonb_build_object(
    'full_name',coalesce(nullif(j.context->>'full_name',''),v_context->>'full_name'),
    'recipient_greeting',coalesce(nullif(j.context->>'recipient_greeting',''),v_context->>'recipient_greeting'),
    'formal_recipient_greeting',coalesce(nullif(j.context->>'formal_recipient_greeting',''),v_context->>'formal_recipient_greeting'));
  end if;
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
-- Missing role templates are seeded only. Preserve all customized bodies and
-- inactive flags, including the active state of the existing all-audience fallback.
DO $templates$
DECLARE
 v_event text; v_audience text; v_title text; v_body text; v_details text;
 v_sms public.sms_templates; v_notification public.notification_templates;
 v_fields text[]:=ARRAY['formal_recipient_greeting','recipient_greeting','full_name','meeting_subject',
  'series_weekdays','recurrence_frequency','start_time','series_start_date','series_end_date',
  'occurrence_count','meeting_date','meeting_time','location_part','series_pattern','summary'];
BEGIN
 FOREACH v_event IN ARRAY ARRAY['series_invite','series_change','series_cancel','series_reminder'] LOOP
  SELECT * INTO v_sms FROM public.sms_templates WHERE category='meeting' AND event_type=v_event AND audience='all';
  SELECT * INTO v_notification FROM public.notification_templates WHERE category='meeting' AND event_type=v_event AND audience='all';
  FOREACH v_audience IN ARRAY ARRAY['creator','participants','observers','external','external_observers'] LOOP
   v_details:=E'روز برگزاری: {{series_weekdays}}\nساعت: {{start_time}}\nدوره تکرار: {{recurrence_frequency}}\nاز تاریخ {{series_start_date}} تا {{series_end_date}}\nتعداد جلسات برنامه‌ریزی‌شده: {{occurrence_count}}';
   IF v_event='series_invite' THEN
    IF v_audience='creator' THEN
     v_title:='ثبت جلسات تکرارشونده';
     v_body:=E'{{formal_recipient_greeting}}\n\nمجموعه جلسات تکرارشونده «{{meeting_subject}}» توسط شما ثبت شد.\n\n'||v_details||E'\n\nبرنامه کامل جلسات در تقویم سامانه اسپارک ثبت شده است.';
    ELSIF v_audience IN('observers','external_observers') THEN
     v_title:='اطلاع از جلسات تکرارشونده';
     v_body:=E'{{formal_recipient_greeting}}\n\nشما به‌عنوان مطلع مجموعه جلسات تکرارشونده «{{meeting_subject}}» ثبت شده‌اید.\n\n'||v_details||E'\n\nاین پیام جهت اطلاع شما ارسال شده است.';
    ELSE
     v_title:='دعوت به جلسات تکرارشونده';
     v_body:=coalesce(nullif(v_sms.body,''),E'{{formal_recipient_greeting}}\n\nشما به مجموعه جلسات تکرارشونده «{{meeting_subject}}» دعوت شده‌اید.\n\n'||v_details||E'\n\nبرنامه جلسات در سامانه اسپارک ثبت شده است.');
    END IF;
   ELSIF v_event='series_change' THEN
    v_title:='تغییر جلسات تکرارشونده';
    v_body:=coalesce(nullif(v_sms.body,''),E'{{recipient_greeting}}\nبرنامه جلسات «{{meeting_subject}}» تغییر کرده است.\n'||v_details);
   ELSIF v_event='series_cancel' THEN
    v_title:='لغو جلسات تکرارشونده';
    v_body:=coalesce(nullif(v_sms.body,''),E'{{recipient_greeting}}\nجلسات یا دعوت شما به «{{meeting_subject}}» برای نوبت‌های مرتبط لغو شده است.\n'||v_details);
   ELSE
    v_title:='یادآوری جلسه تکرارشونده';
    v_body:=coalesce(nullif(v_sms.body,''),E'{{recipient_greeting}}\nیادآوری جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}}، ساعت {{meeting_time}}{{location_part}}');
   END IF;
   INSERT INTO public.sms_templates(category,event_type,audience,subject,body,placeholders,is_active)
   VALUES('meeting',v_event,v_audience,v_title,v_body,v_fields,coalesce(v_sms.is_active,true))
   ON CONFLICT(category,event_type,audience) DO NOTHING;

   IF NOT(v_event='series_invite' AND v_audience IN('creator','observers','external_observers')) THEN
    v_body:=coalesce(nullif(v_notification.body,''),v_body);
    v_title:=coalesce(nullif(v_notification.title,''),v_title);
   END IF;
   INSERT INTO public.notification_templates(category,event_type,audience,title,body,placeholders,is_active,icon,color)
   VALUES('meeting',v_event,v_audience,v_title,v_body,v_fields,coalesce(v_notification.is_active,true),coalesce(v_notification.icon,'bell'),coalesce(v_notification.color,'blue'))
   ON CONFLICT(category,event_type,audience) DO NOTHING;
  END LOOP;
 END LOOP;
END;
$templates$;

NOTIFY pgrst,'reload schema';
