-- Configurable schedules for automatic decision notifications.
-- Manual/user-selected reminders remain untouched.

insert into public.system_config (section,key,value,value_type,label,description)
values
 ('minutes','decision_due_schedule_enabled','true','boolean','فعال بودن هشدار سررسید و تأخیر مصوبات','ارسال خودکار اعلان/پیامک سررسید نزدیک و مصوبات تأخیردار'),
 ('minutes','decision_due_schedule_time','09:00','time','ساعت هشدار سررسید و تأخیر مصوبات','ساعت محلی تهران برای ارسال خودکار'),
 ('minutes','decision_due_schedule_weekdays','sat,sun,mon,tue,wed,thu,fri','weekdays','روزهای هشدار سررسید و تأخیر مصوبات','روزهای مجاز ارسال خودکار'),
 ('minutes','periodic_followup_schedule_enabled','true','boolean','فعال بودن پیگیری دوره‌ای مصوبات','ارسال خودکار پیگیری‌های دوره‌ای هفتگی/ماهانه'),
 ('minutes','periodic_followup_schedule_time','09:00','time','ساعت پیگیری دوره‌ای مصوبات','ساعت محلی تهران برای ارسال خودکار'),
 ('minutes','periodic_followup_schedule_weekdays','sat,sun,mon,tue,wed,thu,fri','weekdays','روزهای پیگیری دوره‌ای مصوبات','روزهای مجاز ارسال خودکار')
on conflict (section,key) do nothing;

create or replace function private.get_minutes_notification_schedule(p_kind text)
returns table(enabled boolean,send_time time without time zone,weekdays text[])
language plpgsql stable security definer set search_path=''
as $$
declare
 v_prefix text; v_enabled_raw text; v_time_raw text; v_days_raw text; v_days text[];
 v_all_days constant text[]:=array['sat','sun','mon','tue','wed','thu','fri'];
begin
 if p_kind='decision_due' then v_prefix:='decision_due_schedule_';
 elsif p_kind='periodic_followup' then v_prefix:='periodic_followup_schedule_';
 else return query select true,time '09:00',v_all_days; return; end if;
 select max(value) filter(where key=v_prefix||'enabled'),max(value) filter(where key=v_prefix||'time'),max(value) filter(where key=v_prefix||'weekdays')
 into v_enabled_raw,v_time_raw,v_days_raw
 from public.system_config where section='minutes' and key in(v_prefix||'enabled',v_prefix||'time',v_prefix||'weekdays');
 enabled:=lower(coalesce(v_enabled_raw,'true'))<>'false';
 begin
  if coalesce(v_time_raw,'') ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then send_time:=v_time_raw::time; else send_time:=time '09:00'; end if;
 exception when others then send_time:=time '09:00'; end;
 v_days:=string_to_array(lower(coalesce(v_days_raw,'')),',');
 if coalesce(array_length(v_days,1),0)=0 or exists(select 1 from unnest(v_days) d where d<>all(v_all_days)) then weekdays:=v_all_days;
 else select array_agg(distinct d order by d) into weekdays from unnest(v_days) d; end if;
 return next;
end $$;

revoke all on function private.get_minutes_notification_schedule(text) from public,anon,authenticated;
grant execute on function private.get_minutes_notification_schedule(text) to service_role;

create or replace function private.minutes_weekday_token(p_date date)
returns text language sql immutable set search_path=''
as $$select case extract(dow from p_date)::int when 0 then 'sun' when 1 then 'mon' when 2 then 'tue' when 3 then 'wed' when 4 then 'thu' when 5 then 'fri' else 'sat' end$$;

create or replace function private.minutes_local_schedule_at(p_date date,p_time time without time zone)
returns timestamptz language sql immutable set search_path=''
as $$select (p_date::text||' '||to_char(p_time,'HH24:MI')||':00')::timestamp at time zone 'Asia/Tehran'$$;

create or replace function public.claim_due_overdue_decisions(p_lead_days integer default 1)
returns void language plpgsql security definer set search_path=''
as $$
declare
 v_today date:=(now() at time zone 'Asia/Tehran')::date; v_due_soon_date date; v_enabled boolean; v_send_time time; v_weekdays text[];
 v_delivery timestamptz; v_idempotency text; v_context jsonb; v_queue jsonb; v_outbox_id uuid; v_rec record;
begin
 v_due_soon_date:=v_today+p_lead_days;
 select s.enabled,s.send_time,s.weekdays into v_enabled,v_send_time,v_weekdays from private.get_minutes_notification_schedule('decision_due') s;
 if not coalesce(v_enabled,true) or not(private.minutes_weekday_token(v_today)=any(coalesce(v_weekdays,array['sat','sun','mon','tue','wed','thu','fri']::text[]))) then return; end if;
 v_delivery:=greatest(private.minutes_local_schedule_at(v_today,coalesce(v_send_time,time '09:00')),now());
 for v_rec in
  select d.id decision_id,d.primary_owner_user_id,d.title,d.due_date,d.minute_id,m.meeting_title_snapshot minute_title
  from public.minutes_decisions d join public.minutes m on m.id=d.minute_id
  where d.status not in('completed','stopped') and d.primary_owner_user_id is not null and d.due_date=v_due_soon_date
   and m.status='published' and m.published_at is not null
   and(d.parent_decision_id is not null or not exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id))
 loop
  v_idempotency:='decision:'||v_rec.decision_id||':decision_due_soon:'||v_today||':'||v_rec.primary_owner_user_id;
  v_context:=jsonb_build_object('decision_title',v_rec.title,'decision_due_date',v_rec.due_date::text,'minute_title',coalesce(v_rec.minute_title,''),'decision_link','#minutes-my-decisions?decision='||v_rec.decision_id,'audience','decision_owner');
  v_queue:=public.resolve_and_queue_notification('decision_due_soon',v_rec.primary_owner_user_id,'decision_owner','decision',v_rec.decision_id,v_rec.minute_id,null,v_context,v_idempotency,null);
  v_outbox_id:=nullif(v_queue->>'outbox_id','')::uuid;
  if v_outbox_id is not null then update public.notification_outbox set available_at=v_delivery,next_attempt_at=v_delivery where id=v_outbox_id and status='pending' and processed_at is null; end if;
 end loop;
 for v_rec in
  select d.id decision_id,d.primary_owner_user_id,d.title,d.due_date,d.minute_id,m.meeting_title_snapshot minute_title
  from public.minutes_decisions d join public.minutes m on m.id=d.minute_id
  where d.status not in('completed','stopped') and d.primary_owner_user_id is not null and d.due_date<v_today
   and m.status='published' and m.published_at is not null
   and(d.parent_decision_id is not null or not exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id))
 loop
  v_idempotency:='decision:'||v_rec.decision_id||':decision_overdue:'||v_today||':'||v_rec.primary_owner_user_id;
  v_context:=jsonb_build_object('decision_title',v_rec.title,'decision_due_date',v_rec.due_date::text,'minute_title',coalesce(v_rec.minute_title,''),'decision_link','#minutes-my-decisions?decision='||v_rec.decision_id,'audience','decision_owner');
  v_queue:=public.resolve_and_queue_notification('decision_overdue',v_rec.primary_owner_user_id,'decision_owner','decision',v_rec.decision_id,v_rec.minute_id,null,v_context,v_idempotency,null);
  v_outbox_id:=nullif(v_queue->>'outbox_id','')::uuid;
  if v_outbox_id is not null then update public.notification_outbox set available_at=v_delivery,next_attempt_at=v_delivery where id=v_outbox_id and status='pending' and processed_at is null; end if;
 end loop;
end $$;

create or replace function public.materialize_due_minutes_periodic_reminders(p_limit integer default 100)
returns integer language plpgsql security definer set search_path=''
as $$
declare
 v_row record; v_recipient uuid; v_next timestamptz; v_created integer:=0; v_enabled boolean; v_send_time time; v_weekdays text[];
 v_today date:=(now() at time zone 'Asia/Tehran')::date; v_delivery timestamptz; v_target_date date;
begin
 update public.minutes_decision_reminders r set status='cancelled',cancelled_at=coalesce(r.cancelled_at,now()),updated_at=now()
 from public.minutes_decisions d where d.id=r.decision_id and d.status in('completed','stopped') and r.status in('pending','processing');
 update public.minutes_decisions d set next_periodic_followup_at=null,updated_at=now()
 where(d.followup_recurrence='none' or d.status in('completed','stopped')) and d.next_periodic_followup_at is not null;
 select s.enabled,s.send_time,s.weekdays into v_enabled,v_send_time,v_weekdays from private.get_minutes_notification_schedule('periodic_followup') s;
 v_send_time:=coalesce(v_send_time,time '09:00');
 update public.minutes_decisions d set next_periodic_followup_at=private.minutes_local_schedule_at(
  case d.followup_recurrence when 'weekly' then(m.published_at at time zone 'Asia/Tehran')::date+7 else(((m.published_at at time zone 'Asia/Tehran')::date+interval '1 month')::date) end,v_send_time),updated_at=now()
 from public.minutes m where m.id=d.minute_id and m.status='published' and m.published_at is not null and d.followup_recurrence in('weekly','monthly') and d.status not in('completed','stopped') and d.next_periodic_followup_at is null;
 update public.minutes_decisions d set next_periodic_followup_at=private.minutes_local_schedule_at((d.next_periodic_followup_at at time zone 'Asia/Tehran')::date,v_send_time),updated_at=now()
 where d.followup_recurrence in('weekly','monthly') and d.status not in('completed','stopped') and d.next_periodic_followup_at is not null
  and(d.next_periodic_followup_at at time zone 'Asia/Tehran')::time is distinct from v_send_time;
 if not coalesce(v_enabled,true) or not(private.minutes_weekday_token(v_today)=any(coalesce(v_weekdays,array['sat','sun','mon','tue','wed','thu','fri']::text[]))) then return 0; end if;
 v_delivery:=private.minutes_local_schedule_at(v_today,v_send_time);
 for v_row in
  select d.id decision_id,d.minute_id,d.primary_owner_user_id,d.followup_recurrence,d.followup_recipient_type,d.next_periodic_followup_at,d.created_by_user_id,m.secretary_user_id
  from public.minutes_decisions d join public.minutes m on m.id=d.minute_id
  where d.followup_recurrence in('weekly','monthly') and d.status not in('completed','stopped') and d.next_periodic_followup_at is not null
   and(d.next_periodic_followup_at at time zone 'Asia/Tehran')::date<=v_today and m.status='published' and m.published_at is not null
   and(d.parent_decision_id is not null or not exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id))
  order by d.next_periodic_followup_at limit least(greatest(coalesce(p_limit,100),1),500) for update of d skip locked
 loop
  v_recipient:=case v_row.followup_recipient_type when 'owner' then v_row.primary_owner_user_id else v_row.secretary_user_id end;
  if v_recipient is null then v_recipient:=v_row.secretary_user_id; end if;
  if v_recipient is not null then
   insert into public.minutes_decision_reminders(decision_id,minute_id,recipient_user_id,remind_at,status,created_by_user_id,recurrence_cycle_at,recipient_type)
   values(v_row.decision_id,v_row.minute_id,v_recipient,v_delivery,'pending',v_row.created_by_user_id,v_row.next_periodic_followup_at,v_row.followup_recipient_type)
   on conflict(decision_id,recurrence_cycle_at) where recurrence_cycle_at is not null do nothing;
   if found then v_created:=v_created+1; end if;
  end if;
  v_next:=v_row.next_periodic_followup_at;
  loop
   v_target_date:=case v_row.followup_recurrence when 'weekly' then(v_next at time zone 'Asia/Tehran')::date+7 else(((v_next at time zone 'Asia/Tehran')::date+interval '1 month')::date) end;
   v_next:=private.minutes_local_schedule_at(v_target_date,v_send_time);
   exit when(v_next at time zone 'Asia/Tehran')::date>v_today;
  end loop;
  update public.minutes_decisions set next_periodic_followup_at=v_next,updated_at=now() where id=v_row.decision_id;
 end loop;
 return v_created;
end $$;

drop function public.claim_due_minutes_decision_reminders(integer);
create function public.claim_due_minutes_decision_reminders(p_limit integer default 50)
returns table(id uuid,decision_id uuid,minute_id uuid,recipient_user_id uuid,decision_title text,recurrence_cycle_at timestamptz,recipient_type text,remind_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare v_stuck_threshold timestamptz:=now()-interval '10 minutes'; v_today date:=(now() at time zone 'Asia/Tehran')::date; v_claimed_ids uuid[];
begin
 select array_agg(sub.rid) into v_claimed_ids from(
  select r.id rid from public.minutes_decision_reminders r join public.minutes_decisions d on d.id=r.decision_id join public.minutes m on m.id=d.minute_id
  where((r.status='pending' and r.remind_at<=now()) or(r.status='pending' and r.recurrence_cycle_at is not null and(r.remind_at at time zone 'Asia/Tehran')::date<=v_today) or(r.status='processing' and r.updated_at<v_stuck_threshold))
   and d.status not in('completed','stopped') and m.status='published' and m.published_at is not null
   and(d.parent_decision_id is not null or not exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id))
  order by r.remind_at limit least(greatest(coalesce(p_limit,50),1),100) for update of r skip locked) sub;
 if v_claimed_ids is null or array_length(v_claimed_ids,1) is null then return; end if;
 update public.minutes_decision_reminders r set status='processing',updated_at=now() where r.id=any(v_claimed_ids);
 return query select r.id,r.decision_id,r.minute_id,r.recipient_user_id,d.title,r.recurrence_cycle_at,r.recipient_type,r.remind_at
 from public.minutes_decision_reminders r join public.minutes_decisions d on d.id=r.decision_id join public.minutes m on m.id=d.minute_id
 where r.id=any(v_claimed_ids) and d.status not in('completed','stopped') and m.status='published' and m.published_at is not null
  and(d.parent_decision_id is not null or not exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id)) order by r.remind_at;
end $$;
revoke all on function public.claim_due_minutes_decision_reminders(integer) from public,anon,authenticated;
grant execute on function public.claim_due_minutes_decision_reminders(integer) to service_role;
