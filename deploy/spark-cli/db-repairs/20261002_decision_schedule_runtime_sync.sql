-- Manual repair for decision due/overdue delivery scheduling.
-- NOT a migration and NOT executed by Update Supabase.
-- Preserves existing system_config values and only aligns runtime functions.

create or replace function private.get_minutes_notification_schedule(p_kind text)
returns table(enabled boolean, send_time time without time zone, weekdays text[])
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_prefix text;
  v_enabled_raw text;
  v_time_raw text;
  v_days_raw text;
  v_days text[];
  v_all_days constant text[] := array['sat','sun','mon','tue','wed','thu','fri'];
begin
  if p_kind='decision_due' then
    v_prefix := 'decision_due_schedule_';
  elsif p_kind='periodic_followup' then
    v_prefix := 'periodic_followup_schedule_';
  else
    return query select true,time '09:00',v_all_days;
    return;
  end if;

  select
    max(value) filter(where key=v_prefix||'enabled'),
    max(value) filter(where key=v_prefix||'time'),
    max(value) filter(where key=v_prefix||'weekdays')
  into v_enabled_raw,v_time_raw,v_days_raw
  from public.system_config
  where section='minutes'
    and key in(v_prefix||'enabled',v_prefix||'time',v_prefix||'weekdays');

  enabled := lower(coalesce(v_enabled_raw,'true')) <> 'false';

  begin
    if coalesce(v_time_raw,'') ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
      send_time := v_time_raw::time;
    else
      send_time := time '09:00';
    end if;
  exception when others then
    send_time := time '09:00';
  end;

  v_days := string_to_array(lower(coalesce(v_days_raw,'')),',');
  if coalesce(array_length(v_days,1),0)=0
     or exists(select 1 from unnest(v_days) d where d<>all(v_all_days)) then
    weekdays := v_all_days;
  else
    select array_agg(distinct d order by d) into weekdays from unnest(v_days) d;
  end if;

  return next;
end;
$function$;

create or replace function private.minutes_local_schedule_at(
  p_date date,
  p_time time without time zone
)
returns timestamptz
language sql
immutable
set search_path = ''
as $function$
  select (p_date::text||' '||to_char(p_time,'HH24:MI')||':00')::timestamp
         at time zone 'Asia/Tehran'
$function$;

create or replace function public.claim_due_overdue_decisions(p_lead_days integer default 1)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_today date := (now() at time zone 'Asia/Tehran')::date;
  v_due_soon_date date;
  v_enabled boolean;
  v_send_time time;
  v_weekdays text[];
  v_delivery timestamptz;
  v_idempotency text;
  v_context jsonb;
  v_rec record;
begin
  v_due_soon_date := v_today + p_lead_days;

  select s.enabled,s.send_time,s.weekdays
  into v_enabled,v_send_time,v_weekdays
  from private.get_minutes_notification_schedule('decision_due') s;

  if not coalesce(v_enabled,true)
     or not(private.minutes_weekday_token(v_today)=any(coalesce(v_weekdays,array['sat','sun','mon','tue','wed','thu','fri']::text[]))) then
    return;
  end if;

  v_delivery := greatest(
    private.minutes_local_schedule_at(v_today,coalesce(v_send_time,time '09:00')),
    now()
  );

  for v_rec in
    select d.id decision_id,d.primary_owner_user_id,d.title,d.due_date,d.minute_id,
           m.meeting_title_snapshot minute_title
    from public.minutes_decisions d
    join public.minutes m on m.id=d.minute_id
    where d.status not in('completed','stopped')
      and d.primary_owner_user_id is not null
      and d.due_date=v_due_soon_date
      and m.status='published'
      and m.published_at is not null
      and(d.parent_decision_id is not null or not exists(
        select 1 from public.minutes_decisions c where c.parent_decision_id=d.id
      ))
  loop
    v_idempotency := 'decision:'||v_rec.decision_id||':decision_due_soon:'||v_today||':'||v_rec.primary_owner_user_id;
    v_context := jsonb_build_object(
      'decision_title',v_rec.title,
      'decision_due_date',v_rec.due_date::text,
      'minute_title',coalesce(v_rec.minute_title,''),
      'decision_link','#minutes-my-decisions?decision='||v_rec.decision_id,
      'audience','decision_owner'
    );

    perform public.resolve_and_queue_notification(
      'decision_due_soon',
      v_rec.primary_owner_user_id,
      'decision_owner',
      'decision',
      v_rec.decision_id,
      v_rec.minute_id,
      null,
      v_context,
      v_idempotency,
      null
    );

    update public.notification_outbox
       set available_at=v_delivery,
           next_attempt_at=v_delivery
     where entity_id=v_rec.decision_id
       and event_type='decision_due_soon'
       and status='pending'
       and processed_at is null
       and idempotency_key like('decision:'||v_rec.decision_id||':decision_due_soon:'||v_today||':%');
  end loop;

  for v_rec in
    select d.id decision_id,d.primary_owner_user_id,d.title,d.due_date,d.minute_id,
           m.meeting_title_snapshot minute_title
    from public.minutes_decisions d
    join public.minutes m on m.id=d.minute_id
    where d.status not in('completed','stopped')
      and d.primary_owner_user_id is not null
      and d.due_date<v_today
      and m.status='published'
      and m.published_at is not null
      and(d.parent_decision_id is not null or not exists(
        select 1 from public.minutes_decisions c where c.parent_decision_id=d.id
      ))
  loop
    v_idempotency := 'decision:'||v_rec.decision_id||':decision_overdue:'||v_today||':'||v_rec.primary_owner_user_id;
    v_context := jsonb_build_object(
      'decision_title',v_rec.title,
      'decision_due_date',v_rec.due_date::text,
      'minute_title',coalesce(v_rec.minute_title,''),
      'decision_link','#minutes-my-decisions?decision='||v_rec.decision_id,
      'audience','decision_owner'
    );

    perform public.resolve_and_queue_notification(
      'decision_overdue',
      v_rec.primary_owner_user_id,
      'decision_owner',
      'decision',
      v_rec.decision_id,
      v_rec.minute_id,
      null,
      v_context,
      v_idempotency,
      null
    );

    update public.notification_outbox
       set available_at=v_delivery,
           next_attempt_at=v_delivery
     where entity_id=v_rec.decision_id
       and event_type='decision_overdue'
       and status='pending'
       and processed_at is null
       and idempotency_key like('decision:'||v_rec.decision_id||':decision_overdue:'||v_today||':%');
  end loop;
end;
$function$;

notify pgrst, 'reload schema';
