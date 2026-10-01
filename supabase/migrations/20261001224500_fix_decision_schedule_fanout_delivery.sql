-- resolve_and_queue_notification may fan out decision events to owner + secretary
-- and then returns a results array instead of one outbox_id. Schedule all pending
-- rows for the event/day rather than relying on a single returned id.

create or replace function public.claim_due_overdue_decisions(p_lead_days integer default 1)
returns void language plpgsql security definer set search_path=''
as $$
declare
 v_today date:=(now() at time zone 'Asia/Tehran')::date; v_due_soon_date date; v_enabled boolean; v_send_time time; v_weekdays text[];
 v_delivery timestamptz; v_idempotency text; v_context jsonb; v_rec record;
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
  perform public.resolve_and_queue_notification('decision_due_soon',v_rec.primary_owner_user_id,'decision_owner','decision',v_rec.decision_id,v_rec.minute_id,null,v_context,v_idempotency,null);
  update public.notification_outbox
     set available_at=v_delivery,next_attempt_at=v_delivery
   where entity_id=v_rec.decision_id and event_type='decision_due_soon' and status='pending' and processed_at is null
     and idempotency_key like ('decision:'||v_rec.decision_id||':decision_due_soon:'||v_today||':%');
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
  perform public.resolve_and_queue_notification('decision_overdue',v_rec.primary_owner_user_id,'decision_owner','decision',v_rec.decision_id,v_rec.minute_id,null,v_context,v_idempotency,null);
  update public.notification_outbox
     set available_at=v_delivery,next_attempt_at=v_delivery
   where entity_id=v_rec.decision_id and event_type='decision_overdue' and status='pending' and processed_at is null
     and idempotency_key like ('decision:'||v_rec.decision_id||':decision_overdue:'||v_today||':%');
 end loop;
end $$;
