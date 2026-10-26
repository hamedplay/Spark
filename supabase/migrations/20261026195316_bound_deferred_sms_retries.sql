-- Retain failed deliveries for inspection, but never claim a permanent template
-- context failure again. Bound transient failures consistently with the outbox.
CREATE OR REPLACE FUNCTION public.claim_deferred_sms_queue(p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, delivery_mode text, target_user_id uuid, target_phones text[],
  category text, event_type text, audience text, context jsonb, meeting_id uuid,
  actor_user_id uuid, event_key text, raw_message text, provider_id uuid, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_ids uuid[];
begin
  select array_agg(q.id)
  into v_ids
  from (
    select d.id
    from public.deferred_sms_queue d
    where d.status in ('pending','failed')
      and d.available_at<=now()
      and d.attempt_count<5
      and coalesce(d.last_error,'') not like 'SMS_TEMPLATE_CONTEXT_MISSING:%'
    order by d.available_at,d.created_at
    limit least(greatest(p_limit,1),100)
    for update skip locked
  ) q;

  if v_ids is null then return; end if;

  update public.deferred_sms_queue d
  set status='processing',
      attempt_count=d.attempt_count+1,
      last_error=null
  where d.id=any(v_ids);

  return query
  select d.id,d.delivery_mode,d.target_user_id,d.target_phones,d.category,d.event_type,
         d.audience,d.context,d.meeting_id,d.actor_user_id,d.event_key,d.raw_message,
         d.provider_id,d.attempt_count
  from public.deferred_sms_queue d
  where d.id=any(v_ids)
  order by d.available_at,d.created_at;
end;
$function$;
