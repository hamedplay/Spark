-- Recurring series remain materialized meetings; old rows deliberately stay unlinked.
alter table public.meetings add column if not exists series_id uuid;
create index if not exists meetings_series_owner_date_idx on public.meetings(series_id,user_id,request_date) where series_id is not null;
create table private.meeting_series_batches (
  id uuid primary key, owner_id uuid not null, request_hash text not null,
  meeting_ids uuid[] not null default '{}', created_at timestamptz not null default now()
);
alter table private.meeting_series_batches enable row level security;
create table private.recurring_notification_policy (
  singleton boolean primary key default true check(singleton),
  invite_in_app boolean not null default true, invite_sms boolean not null default true,
  change_in_app boolean not null default true, change_sms boolean not null default true,
  reminder_in_app boolean not null default true, reminder_sms boolean not null default false,
  external_reminder_sms boolean not null default false,
  updated_at timestamptz not null default now(), updated_by uuid
);
alter table private.recurring_notification_policy enable row level security;
insert into private.recurring_notification_policy(singleton) values(true);
create table private.meeting_notification_jobs (
  id uuid primary key default gen_random_uuid(), event_key text not null unique,
  series_id uuid not null, event_type text not null, audience text not null,
  recipient_id uuid, target_phone text, actor_id uuid not null,
  meetings jsonb not null, context jsonb not null default '{}',
  status text not null default 'pending' check(status in ('pending','processing','sent','skipped','failed','uncertain')),
  attempts integer not null default 0, available_at timestamptz not null default now(),
  lease uuid, last_error text, created_at timestamptz not null default now(), processed_at timestamptz,
  check ((recipient_id is not null) <> (target_phone is not null))
);
alter table private.meeting_notification_jobs enable row level security;
create index meeting_notification_jobs_due_idx on private.meeting_notification_jobs(available_at) where status='pending';
revoke all on private.meeting_series_batches,private.recurring_notification_policy,private.meeting_notification_jobs from public,anon,authenticated;

create function public.get_recurring_notification_policy() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_current_session_fully_authorized() or not private.is_current_user_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select to_jsonb(p)-'singleton' from private.recurring_notification_policy p);
end $$;
create function public.set_recurring_notification_policy(p_policy jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_current_session_fully_authorized() or not private.is_current_user_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 update private.recurring_notification_policy set
 invite_in_app=(p_policy->>'invite_in_app')::boolean,invite_sms=(p_policy->>'invite_sms')::boolean,
 change_in_app=(p_policy->>'change_in_app')::boolean,change_sms=(p_policy->>'change_sms')::boolean,
 reminder_in_app=(p_policy->>'reminder_in_app')::boolean,reminder_sms=(p_policy->>'reminder_sms')::boolean,
 external_reminder_sms=(p_policy->>'external_reminder_sms')::boolean,updated_at=now(),updated_by=auth.uid();
end $$;
revoke all on function public.get_recurring_notification_policy(),public.set_recurring_notification_policy(jsonb) from public,anon;
grant execute on function public.get_recurring_notification_policy(),public.set_recurring_notification_policy(jsonb) to authenticated;

create function private.meeting_local_date(p_raw text) returns date language plpgsql immutable set search_path='' as $$
begin
 if nullif(trim(p_raw),'') is null then return null; end if;
 if p_raw ~ 'T|Z|[+]\\d\\d' then return (p_raw::timestamptz at time zone 'Asia/Tehran')::date; end if;
 return p_raw::date;
exception when others then return null;
end $$;
create function private.meeting_phone(p_raw text) returns text language sql immutable set search_path='' as $$
 select case when left(x,4)='0098' then '0'||substr(x,5) when left(x,2)='98' then '0'||substr(x,3) when length(x)=10 and left(x,1)='9' then '0'||x else x end
 from (select regexp_replace(translate(coalesce(p_raw,''),'۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789'),'[^0-9]','','g') x)s;
$$;

-- Only this transaction-scoped command can attach new rows to a series.
create function private.guard_meeting_series_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.series_id is distinct from old.series_id or new.user_id is distinct from old.user_id) and old.series_id is not null then raise exception 'SERIES_IDENTITY_IMMUTABLE'; end if;
 if new.series_id is not null and (tg_op='INSERT' or new.series_id is distinct from old.series_id) then
   if current_setting('spark.creating_series',true) is distinct from new.series_id::text or not exists(select 1 from private.meeting_series_batches b where b.id=new.series_id and b.owner_id=new.user_id) then raise exception 'USE_CREATE_MEETING_SERIES'; end if;
 end if;
 return new;
end $$;
create trigger guard_meeting_series_identity before insert or update on public.meetings for each row execute function private.guard_meeting_series_identity();

create function public.create_meeting_series(p_operation_id uuid,p_records jsonb,p_agenda jsonb default '[]',p_pattern text default '') returns uuid[] language plpgsql security definer set search_path='' as $$
declare v_hash text; v_batch private.meeting_series_batches; v_ids uuid[]; v_record jsonb; v_id uuid; v_owner uuid:=auth.uid(); v_base jsonb; v_columns text; v_select text;
begin
 if v_owner is null or not private.is_current_session_fully_authorized() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_records is null or p_agenda is null or p_operation_id is null or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records) not between 1 and 600 or jsonb_typeof(p_agenda)<>'array' or length(coalesce(p_pattern,''))>200 then raise exception 'INVALID_SERIES'; end if;
 v_hash:=encode(extensions.digest((p_records::text||p_agenda::text||p_pattern),'sha256'),'hex');
 insert into private.meeting_series_batches(id,owner_id,request_hash) values(p_operation_id,v_owner,v_hash) on conflict do nothing;
 select * into v_batch from private.meeting_series_batches where id=p_operation_id for update;
 if v_batch.owner_id<>v_owner or v_batch.request_hash<>v_hash then raise exception 'OPERATION_CONFLICT'; end if;
 if cardinality(v_batch.meeting_ids)>0 then return v_batch.meeting_ids; end if;
 v_base:=p_records->0;
 for v_record in select value from jsonb_array_elements(p_records) loop
   if (v_record->>'user_id')::uuid is distinct from v_owner or coalesce(v_record->>'repeat_type','none') not in ('weekly','monthly') then raise exception 'INVALID_SERIES_OWNER_OR_REPEAT'; end if;
   if coalesce((v_record->>'repeat_interval')::integer,1) not between 1 and 120 then raise exception 'INVALID_REPEAT_INTERVAL'; end if;
   if private.meeting_local_date(v_record->>'request_date') is null then raise exception 'MEETING_DATE_REQUIRED'; end if;
   if (v_record-'request_date'-'request_jalaali_date'-'status') is distinct from (v_base-'request_date'-'request_jalaali_date'-'status') then raise exception 'SERIES_FIELDS_MUST_MATCH'; end if;
 end loop;
 perform set_config('spark.creating_series',p_operation_id::text,true);
 perform set_config('spark.series_pattern',p_pattern,true);
 -- Explicit allowlist; never accept ids, version, owner overrides or server metadata.
 select string_agg(quote_ident(c),','),string_agg('r.'||quote_ident(c),',') into v_columns,v_select from unnest(array['subject','request_date','request_jalaali_date','duration','request_duration','location','representative','phone','notes','priority','status','status_type','user_id','start_time','end_time','notify_users','participant_user_ids','external_participants','external_informees','repeat_type','repeat_interval','repeat_end_date','repeat_weekday','reminder_minutes','send_sms','meeting_manager','calendar_id','members_only','is_online','conference_room_id']) c;
 execute 'insert into public.meetings('||v_columns||',series_id) select '||v_select||',$2 from jsonb_populate_recordset(null::public.meetings,$1) r' using
 (select jsonb_agg(jsonb_build_object('priority','medium','status','open','status_type','requested','location','','representative','','phone','','external_informees',jsonb_build_array(),'notify_users',jsonb_build_array(),'participant_user_ids',jsonb_build_array(),'external_participants',jsonb_build_array(),'send_sms',false,'is_online',false,'members_only',false)||value) from jsonb_array_elements(p_records)),p_operation_id;
 -- RETURNING from dynamic multi-row command is intentionally read by series id below.
 select array_agg(id order by request_date,id) into v_ids from public.meetings where series_id=p_operation_id and user_id=v_owner;
 insert into public.participants(meeting_id,name)
 select m.id,p.full_name from public.meetings m cross join lateral unnest(coalesce(m.participant_user_ids,'{}')) u(id) join public.profiles p on p.user_id=u.id where m.series_id=p_operation_id and nullif(trim(p.full_name),'') is not null;
 insert into public.meeting_agenda_items(meeting_id,title,presenter,duration_minutes,description,sort_order)
 select m.id,a.value->>'title',nullif(a.value->>'presenter',''),nullif(a.value->>'duration_minutes','')::integer,nullif(a.value->>'description',''),a.ordinality::integer-1
 from public.meetings m cross join lateral jsonb_array_elements(p_agenda) with ordinality a(value,ordinality) where m.series_id=p_operation_id;
 update private.meeting_series_batches set meeting_ids=v_ids where id=p_operation_id;
 return v_ids;
end $$;
revoke all on function public.create_meeting_series(uuid,jsonb,jsonb,text) from public,anon;
grant execute on function public.create_meeting_series(uuid,jsonb,jsonb,text) to authenticated;
create function private.meeting_recipients(p_meeting jsonb) returns table(identity text,recipient_id uuid,target_phone text,audience text) language sql stable security definer set search_path='' as $$
 with internal as (
 select distinct u::uuid id, case when u=p_meeting->>'user_id' then 'creator' when (p_meeting->'participant_user_ids') ? u then 'participants' else 'observers' end audience
 from jsonb_array_elements_text(coalesce(p_meeting->'participant_user_ids','[]')||coalesce(p_meeting->'notify_users','[]')||jsonb_build_array(p_meeting->>'user_id')) u
 ), external as (
 select distinct private.meeting_phone(c.phone) phone from public.contacts_email c
 where c.user_id=(p_meeting->>'user_id')::uuid and (coalesce(p_meeting->'external_participants','[]') ? c.name or coalesce(p_meeting->'external_informees','[]') ? c.name)
 )
 select 'user:'||id::text,id,null::text,audience from internal where id is not null
 union all select 'phone:'||phone,null::uuid,phone,'external' from external where length(phone)>=7 and not exists(select 1 from internal i join public.profiles p on p.user_id=i.id where private.meeting_phone(p.phone)=external.phone);
$$;

create function private.queue_meeting_series_events(p_events jsonb) returns void language plpgsql security definer set search_path='' as $$
declare g record; v_first jsonb; v_last jsonb; v_dates text; v_summary text; v_event text; v_context jsonb; v_key text; v_policy private.recurring_notification_policy; v_in_app boolean; v_sms boolean; v_id uuid; v_name text;
begin
 select * into v_policy from private.recurring_notification_policy;
 for g in
 select e->>'series' series,e->>'event' event,e->>'identity' identity,(e->>'recipient')::uuid recipient,e->>'phone' phone,min(e->>'audience') audience,(e->>'actor')::uuid actor,
 jsonb_agg(e->'meeting' order by e->'meeting'->>'request_date') meetings
 from jsonb_array_elements(p_events) e group by e->>'series',e->>'event',e->>'identity',e->>'recipient',e->>'phone',e->>'actor',case when e->>'event'='reminder' then e->'meeting'->>'id' else null end
 loop
  v_first:=g.meetings->0; v_last:=g.meetings->(jsonb_array_length(g.meetings)-1);
  v_dates:=private.format_jalali_date(private.meeting_local_date(v_first->>'request_date'));
  if jsonb_array_length(g.meetings)>1 then v_dates:=v_dates||' تا '||private.format_jalali_date(private.meeting_local_date(v_last->>'request_date'))||' ('||jsonb_array_length(g.meetings)||' نوبت)'; end if;
  v_event:='series_'||g.event;
  v_summary:=case g.event when 'invite' then 'دعوت به' when 'cancel' then 'لغو دعوت/جلسه' when 'reminder' then 'یادآوری' else 'تغییر برنامه' end||' «'||(v_first->>'subject')||'» | '||v_dates||' | ساعت '||coalesce(v_first->>'start_time','')||' تا '||coalesce(v_first->>'end_time','')||' | '||coalesce(v_first->>'location','');
  if jsonb_array_length(g.meetings)>1 then
   v_summary:=v_summary||' | '||coalesce(nullif(current_setting('spark.series_pattern',true),''),case v_first->>'repeat_type' when 'weekly' then 'تکرار هفتگی' else 'تکرار ماهانه' end)||'؛ جزئیات و استثناها در تقویم اسپارک';
  end if;
  v_in_app:=case when g.event='invite' then v_policy.invite_in_app when g.event='reminder' then v_policy.reminder_in_app else v_policy.change_in_app end;
  v_sms:=case when g.event='invite' then v_policy.invite_sms when g.event='reminder' then case when g.phone is not null then v_policy.external_reminder_sms else v_policy.reminder_sms end else v_policy.change_sms end;
  -- Existing per-meeting external SMS opt-in remains authoritative.
  if g.phone is not null then v_sms:=v_sms and coalesce((v_first->>'send_sms')::boolean,false); end if;
  v_key:='series:'||g.series||':'||g.event||':'||txid_current()::text||':'||g.identity;
  if g.event='reminder' then v_key:='series-reminder:'||(v_first->>'id')||':'||md5(coalesce(v_first->>'request_date','')||coalesce(v_first->>'start_time','')||coalesce(v_first->>'reminder_minutes',''))||':'||g.identity; end if;
  v_name:=coalesce((select full_name from public.profiles where user_id=g.recipient),'همکار گرامی');
  v_context:=jsonb_build_object('summary',v_summary,'meeting_subject',v_first->>'subject','meeting_date',private.format_jalali_date(private.meeting_local_date(v_first->>'request_date')),'start_time',coalesce(v_first->>'start_time',''),'end_time',coalesce(v_first->>'end_time',''),'location',coalesce(v_first->>'location',''),'full_name',v_name,'recipient_greeting',v_name||' گرامی','series_id',g.series,'occurrence_count',jsonb_array_length(g.meetings));
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
end $$;

create function private.meeting_series_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare v_new jsonb:='[]'; v_old jsonb:='[]'; m jsonb; o jsonb; r record; v_event text; v_events jsonb:='[]'; v_scheduled boolean; v_old_scheduled boolean; v_important boolean;
begin
 if current_setting('spark.series_notify',true)='off' then return null; end if;
 if tg_op<>'DELETE' then select coalesce(jsonb_agg(to_jsonb(n)),'[]') into v_new from new_meetings n where n.series_id is not null; end if;
 if tg_op<>'INSERT' then select coalesce(jsonb_agg(to_jsonb(o)),'[]') into v_old from old_meetings o where o.series_id is not null; end if;
 for m in select value from jsonb_array_elements(case when tg_op='DELETE' then v_old else v_new end) loop
  o:=null;
  if tg_op='UPDATE' then select value into o from jsonb_array_elements(v_old) where value->>'id'=m->>'id'; end if;
  v_scheduled:=nullif(m->>'start_time','') is not null and nullif(m->>'end_time','') is not null and m->>'status'<>'closed';
  v_old_scheduled:=o is not null and nullif(o->>'start_time','') is not null and nullif(o->>'end_time','') is not null and o->>'status'<>'closed';
  if tg_op='DELETE' then v_scheduled:=false; v_old_scheduled:=true; o:=m; end if;
  if not v_scheduled and not v_old_scheduled then continue; end if;
  v_important:=o is null or (m->>'request_date',m->>'start_time',m->>'end_time',m->>'location',m->>'subject',m->>'is_online') is distinct from (o->>'request_date',o->>'start_time',o->>'end_time',o->>'location',o->>'subject',o->>'is_online');
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
create trigger meeting_series_insert_notifications after insert on public.meetings referencing new table as new_meetings for each statement execute function private.meeting_series_notifications();
create trigger meeting_series_update_notifications after update on public.meetings referencing old table as old_meetings new table as new_meetings for each statement execute function private.meeting_series_notifications();
create trigger meeting_series_delete_notifications after delete on public.meetings referencing old table as old_meetings for each statement execute function private.meeting_series_notifications();
create function private.materialize_series_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare m record; r record; v_events jsonb:='[]'; v_count integer:=0;
begin
 for m in
 select t.* from public.meetings t
 where t.series_id is not null and t.status<>'closed' and t.reminder_minutes between 1 and 10080 and t.start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 and private.meeting_local_date(t.request_date) between (now() at time zone 'Asia/Tehran')::date and (now() at time zone 'Asia/Tehran')::date+7
 and ((private.meeting_local_date(t.request_date)+t.start_time::time) at time zone 'Asia/Tehran')>now()
 and ((private.meeting_local_date(t.request_date)+t.start_time::time) at time zone 'Asia/Tehran')-make_interval(mins=>t.reminder_minutes)<=now()
 and exists(select 1 from private.meeting_recipients(to_jsonb(t)) r where not exists(select 1 from private.meeting_notification_jobs j where j.event_key='series-reminder:'||t.id::text||':'||md5(coalesce(t.request_date,'')||coalesce(t.start_time,'')||coalesce(t.reminder_minutes::text,''))||':'||r.identity))
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

create function public.claim_meeting_notification_jobs(p_limit integer default 50) returns setof jsonb language plpgsql security definer set search_path='' as $$
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
   and (j.event_type<>'series_reminder' or ((private.meeting_local_date(m.request_date)+m.start_time::time) at time zone 'Asia/Tehran')>now());
   if v_valid is null then v_allowed:=false; end if;
  end if;
  if not v_allowed then update private.meeting_notification_jobs set status='skipped',processed_at=now(),last_error='POLICY_DISABLED_OR_EVENT_SUPERSEDED' where id=j.id; continue; end if;
  update private.meeting_notification_jobs set status='processing',attempts=attempts+1,available_at=now(),lease=gen_random_uuid() where id=j.id returning * into j;
  return next to_jsonb(j)-'meetings';
 end loop;
end $$;
create function public.finish_meeting_notification_job(p_id uuid,p_lease uuid,p_status text,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('sent','skipped','failed','uncertain') then raise exception 'INVALID_JOB_STATUS'; end if;
 update private.meeting_notification_jobs set status=p_status,processed_at=now(),last_error=left(p_error,1000) where id=p_id and lease=p_lease and status='processing';
end $$;
create function public.verify_meeting_worker_token(p_candidate text) returns boolean language sql security definer set search_path='' as $$
 select length(p_candidate)>=32 and extensions.digest(p_candidate,'sha256')=extensions.digest(private.safe_vault_secret('meeting_notification_worker_token'),'sha256');
$$;
revoke all on function public.claim_meeting_notification_jobs(integer),public.finish_meeting_notification_job(uuid,uuid,text,text),public.verify_meeting_worker_token(text) from public,anon,authenticated;
grant execute on function public.claim_meeting_notification_jobs(integer),public.finish_meeting_notification_job(uuid,uuid,text,text),public.verify_meeting_worker_token(text) to service_role;

-- Independent worker credentials; no user token or provider secret is stored in cron.
do $$ begin
 if not exists(select 1 from vault.secrets where name='meeting_notification_worker_token') then perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'meeting_notification_worker_token'); end if;
 if not exists(select 1 from vault.secrets where name='meeting_notification_worker_url') and private.safe_vault_secret('pwa_push_function_url') is not null then
  perform vault.create_secret(regexp_replace(private.safe_vault_secret('pwa_push_function_url'),'/functions/v1/.*$','/functions/v1/meeting-notification-worker'),'meeting_notification_worker_url');
 end if;
end $$;
create function private.run_meeting_notification_tick() returns void language plpgsql security definer set search_path='' as $$
declare v_url text; v_token text;
begin
 perform private.materialize_series_reminders();
 -- Keep idempotency records for the lifetime of the affected series. Clean only
 -- completed delivery jobs after the last affected occurrence has passed.
 delete from private.meeting_notification_jobs j where j.status in ('sent','skipped','failed') and j.created_at<now()-interval '90 days'
 and not exists(select 1 from jsonb_array_elements(j.meetings) e where private.meeting_local_date(e->>'request_date') >= (now() at time zone 'Asia/Tehran')::date);
 if not exists(select 1 from private.meeting_notification_jobs where status in ('pending','processing')) then return; end if;
 v_url:=private.safe_vault_secret('meeting_notification_worker_url'); v_token:=private.safe_vault_secret('meeting_notification_worker_token');
 if v_url is null or v_token is null then raise exception 'MEETING_WORKER_NOT_CONFIGURED'; end if;
 perform net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','X-Meeting-Worker-Token',v_token),body:='{}'::jsonb,timeout_milliseconds:=55000);
end $$;
revoke all on function private.meeting_local_date(text),private.meeting_phone(text),private.guard_meeting_series_identity(),private.meeting_recipients(jsonb),private.queue_meeting_series_events(jsonb),private.meeting_series_notifications(),private.materialize_series_reminders(),private.run_meeting_notification_tick() from public,anon,authenticated;
select cron.schedule('spark-recurring-meeting-notifications','* * * * *','select private.run_meeting_notification_tick();');

insert into public.sms_templates(category,event_type,audience,subject,body,placeholders,is_active)
select 'meeting',e,'all','اطلاع‌رسانی جلسات تکراری','{{summary}}',array['summary'],true from unnest(array['series_invite','series_change','series_cancel','series_reminder']) e
on conflict(category,event_type,audience) do nothing;
notify pgrst,'reload schema';
-- Preserve the existing explicit "save without informing" choice, atomically.
create function public.update_meeting_series(p_ids uuid[],p_patch jsonb,p_notify boolean default true) returns void language plpgsql security invoker set search_path='' as $$
declare v_columns text; v_select text; v_series uuid;
begin
 if auth.uid() is null or not private.is_current_session_fully_authorized() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if cardinality(p_ids) not between 1 and 600 or p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'INVALID_UPDATE'; end if;
 if (select count(*) from public.meetings where id=any(p_ids) and user_id=auth.uid() and series_id is not null)<>cardinality(p_ids) or (select count(distinct series_id) from public.meetings where id=any(p_ids))<>1 then raise exception 'SERIES_OWNERSHIP_REQUIRED'; end if;
 if exists(select 1 from jsonb_object_keys(p_patch) k where k<>all(array['subject','request_date','request_jalaali_date','duration','request_duration','location','representative','phone','notes','priority','status','status_type','start_time','end_time','notify_users','participant_user_ids','external_participants','external_informees','repeat_type','repeat_interval','repeat_end_date','repeat_weekday','reminder_minutes','send_sms','meeting_manager','calendar_id','members_only','is_online','conference_room_id'])) then raise exception 'INVALID_UPDATE_FIELD'; end if;
 select string_agg(quote_ident(k),','),string_agg('r.'||quote_ident(k),',') into v_columns,v_select from jsonb_object_keys(p_patch) k;
 if v_columns is null then return; end if;
 perform set_config('spark.series_notify',case when p_notify then 'on' else 'off' end,true);
 execute 'update public.meetings m set ('||v_columns||')=(select '||v_select||' from jsonb_populate_record(m,$1) r) where m.id=any($2) and m.user_id=auth.uid()' using p_patch,p_ids;
end $$;
revoke all on function public.update_meeting_series(uuid[],jsonb,boolean) from public,anon;
grant execute on function public.update_meeting_series(uuid[],jsonb,boolean) to authenticated;
create function public.postpone_meeting_notification_job(p_id uuid,p_lease uuid,p_available_at timestamptz) returns void language plpgsql security definer set search_path='' as $$
begin
 update private.meeting_notification_jobs set status='pending',available_at=greatest(p_available_at,now()+interval '1 minute'),lease=null,last_error='DEFERRED_BY_SMS_POLICY' where id=p_id and lease=p_lease and status='processing';
end $$;
revoke all on function public.postpone_meeting_notification_job(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.postpone_meeting_notification_job(uuid,uuid,timestamptz) to service_role;
