-- Index expression functions are pure; authenticated writes need EXECUTE.
grant execute on function private.meeting_local_date(text) to authenticated;
create or replace function public.update_meeting_series(p_ids uuid[],p_patch jsonb,p_notify boolean default true) returns void language plpgsql security invoker set search_path='' as $$
declare v_columns text; v_select text; v_series uuid;
begin
 if auth.uid() is null or not private.is_current_session_fully_authorized() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_ids is null or cardinality(p_ids) not between 1 and 600 or p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'INVALID_UPDATE'; end if;
 if (select count(*) from public.meetings where id=any(p_ids) and user_id=auth.uid() and series_id is not null)<>cardinality(p_ids) or (select count(distinct series_id) from public.meetings where id=any(p_ids))<>1 then raise exception 'SERIES_OWNERSHIP_REQUIRED'; end if;
 if exists(select 1 from jsonb_object_keys(p_patch) k where k<>all(array['subject','request_date','request_jalaali_date','duration','request_duration','location','representative','phone','notes','priority','status','status_type','start_time','end_time','notify_users','participant_user_ids','external_participants','external_informees','repeat_type','repeat_interval','repeat_end_date','repeat_weekday','reminder_minutes','send_sms','meeting_manager','calendar_id','members_only','is_online','conference_room_id'])) then raise exception 'INVALID_UPDATE_FIELD'; end if;
 select string_agg(quote_ident(k),','),string_agg('r.'||quote_ident(k),',') into v_columns,v_select from jsonb_object_keys(p_patch) k;
 if v_columns is null then return; end if;
 perform set_config('spark.series_notify',case when p_notify then 'on' else 'off' end,true);
 execute 'update public.meetings m set ('||v_columns||')=(select '||v_select||' from jsonb_populate_record(m,$1) r) where m.id=any($2) and m.user_id=auth.uid()' using p_patch,p_ids;
 perform set_config('spark.series_notify','on',true);
end $$;
create or replace function public.claim_meeting_notification_jobs(p_limit integer default 50) returns setof jsonb language plpgsql security definer set search_path='' as $$
declare j private.meeting_notification_jobs; v_valid jsonb; v_policy private.recurring_notification_policy; v_allowed boolean;
begin
 select * into v_policy from private.recurring_notification_policy;
 -- A lost worker response may already have delivered SMS. Never blindly retry it.
 update private.meeting_notification_jobs set status='uncertain',last_error='DELIVERY_OUTCOME_UNKNOWN',processed_at=now() where status='processing' and available_at<now()-interval '5 minutes';
 for j in select * from private.meeting_notification_jobs where status='pending' and available_at<=now() order by created_at limit least(greatest(p_limit,1),100) for update skip locked loop
  v_allowed:=case when j.event_type='series_invite' then v_policy.invite_sms when j.event_type='series_reminder' then case when j.target_phone is not null then v_policy.external_reminder_sms else v_policy.reminder_sms end else v_policy.change_sms end;
  if j.event_type<>'series_cancel' then
   select jsonb_agg(e) into v_valid from jsonb_array_elements(j.meetings) e join public.meetings m on m.id=(e->>'id')::uuid
   where m.series_id=j.series_id and m.status<>'closed' and exists(select 1 from private.meeting_recipients(to_jsonb(m)) r where r.recipient_id=j.recipient_id or r.target_phone=j.target_phone)
   and (m.request_date,m.start_time,m.end_time,m.location,m.subject) is not distinct from (e->>'request_date',e->>'start_time',e->>'end_time',e->>'location',e->>'subject')
   and (j.target_phone is null or coalesce(m.send_sms,false))
   and (j.event_type<>'series_reminder' or not exists(select 1 from public.meeting_inbox i where i.meeting_id=m.id and i.user_id=j.recipient_id and i.status in ('pending','declined')))
   and (j.event_type<>'series_reminder' or ((private.meeting_local_date(m.request_date)+m.start_time::time) at time zone 'Asia/Tehran')>now());
   if v_valid is null then v_allowed:=false; end if;
  end if;
  if not v_allowed then update private.meeting_notification_jobs set status='skipped',processed_at=now(),last_error='POLICY_DISABLED_OR_EVENT_SUPERSEDED' where id=j.id; continue; end if;
  update private.meeting_notification_jobs set status='processing',attempts=attempts+1,available_at=now(),lease=gen_random_uuid() where id=j.id returning * into j;
  return next to_jsonb(j)-'meetings';
 end loop;
end $$;
