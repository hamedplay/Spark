create or replace function private.materialize_series_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare m record; r record; v_events jsonb:='[]'; v_count integer:=0;
begin
 for m in
 select t.* from public.meetings t
 where t.series_id is not null and t.status<>'closed' and t.reminder_minutes between 1 and 10080 and t.start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 and private.meeting_local_date(t.request_date) between (now() at time zone 'Asia/Tehran')::date and (now() at time zone 'Asia/Tehran')::date+7
 and ((private.meeting_local_date(t.request_date)+t.start_time::time) at time zone 'Asia/Tehran')>now()
 and ((private.meeting_local_date(t.request_date)+t.start_time::time) at time zone 'Asia/Tehran')-make_interval(mins=>t.reminder_minutes)<=now()
 and exists(select 1 from private.meeting_recipients(to_jsonb(t)) candidate where not exists(select 1 from private.meeting_notification_jobs j where j.event_key='series-reminder:'||t.id::text||':'||md5(coalesce(t.request_date,'')||coalesce(t.start_time,'')||coalesce(t.reminder_minutes::text,''))||':'||candidate.identity))
 order by t.request_date,t.start_time limit 200
 loop
  for r in select * from private.meeting_recipients(to_jsonb(m)) loop
   if r.recipient_id is not null and exists(select 1 from public.meeting_inbox i where i.meeting_id=m.id and i.user_id=r.recipient_id and i.status in ('declined','pending')) then continue; end if;
   v_events:=v_events||jsonb_build_array(jsonb_build_object('series',m.series_id,'event','reminder','identity',r.identity,'recipient',r.recipient_id,'phone',r.target_phone,'audience',r.audience,'actor',m.user_id,'meeting',to_jsonb(m)));
  end loop;
  v_count:=v_count+1;
 end loop;
 perform private.queue_meeting_series_events(v_events);
 return v_count;
end $$;
