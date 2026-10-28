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

-- Count remaining due work after superseded rows have been skipped.
CREATE OR REPLACE FUNCTION public.get_meeting_delivery_backlog(p_actor_id uuid DEFAULT NULL,p_series_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path='' AS $function$
 SELECT count(*)::integer FROM private.meeting_notification_jobs
 WHERE status='pending' AND available_at<=now()
 AND (p_actor_id IS NULL OR actor_id=p_actor_id) AND (p_series_id IS NULL OR series_id=p_series_id);
$function$;
REVOKE ALL ON FUNCTION public.get_meeting_delivery_backlog(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_meeting_delivery_backlog(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
