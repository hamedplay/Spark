create or replace function private.meeting_series_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare v_new jsonb:='[]'; v_old jsonb:='[]'; m jsonb; o jsonb; r record; v_event text; v_events jsonb:='[]'; v_scheduled boolean; v_old_scheduled boolean; v_important boolean;
begin
 if current_setting('spark.series_notify',true)='off' then return null; end if;
 if tg_op<>'DELETE' then select coalesce(jsonb_agg(to_jsonb(n)),'[]') into v_new from new_meetings n where n.series_id is not null; end if;
 if tg_op<>'INSERT' then select coalesce(jsonb_agg(to_jsonb(previous_row)),'[]') into v_old from old_meetings previous_row where previous_row.series_id is not null; end if;
 for m in select value from jsonb_array_elements(case when tg_op='DELETE' then v_old else v_new end) loop
  o:=null;
  if tg_op='UPDATE' then select value into o from jsonb_array_elements(v_old) where value->>'id'=m->>'id'; end if;
  v_scheduled:=nullif(m->>'start_time','') is not null and nullif(m->>'end_time','') is not null and m->>'status'<>'closed';
  v_old_scheduled:=o is not null and nullif(o->>'start_time','') is not null and nullif(o->>'end_time','') is not null and o->>'status'<>'closed';
  if tg_op='DELETE' then v_scheduled:=false; v_old_scheduled:=true; o:=m; end if;
  if not v_scheduled and not v_old_scheduled then continue; end if;
  v_important:=o is null or (private.meeting_local_date(m->>'request_date'),m->>'start_time',m->>'end_time',m->>'location',m->>'subject',m->>'is_online',m->>'conference_room_id') is distinct from (private.meeting_local_date(o->>'request_date'),o->>'start_time',o->>'end_time',o->>'location',o->>'subject',o->>'is_online',o->>'conference_room_id');
  for r in
   with nr as (select * from private.meeting_recipients(m) where v_scheduled), orr as (select * from private.meeting_recipients(o) where v_old_scheduled)
   select coalesce(nr.identity,orr.identity) identity,coalesce(nr.recipient_id,orr.recipient_id) recipient_id,coalesce(nr.target_phone,orr.target_phone) target_phone,coalesce(nr.audience,orr.audience) audience,nr.identity is not null present,orr.identity is not null was_present
   from nr full join orr using(identity)
  loop
   v_event:=case when not r.present then 'cancel' when not r.was_present then 'invite' when v_important then 'change' else null end;
   if v_event is null then continue; end if;
   v_events:=v_events||jsonb_build_array(jsonb_build_object('series',m->>'series_id','event',v_event,'identity',r.identity,'recipient',r.recipient_id,'phone',r.target_phone,'audience',r.audience,'actor',m->>'user_id','meeting',case when v_event='cancel' then coalesce(o,m) else m end));
  end loop;
 end loop;
 perform private.queue_meeting_series_events(v_events);
 return null;
end $$;
