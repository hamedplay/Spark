-- Fix PL/pgSQL output-column ambiguity in claim_notification_outbox_rows.
-- RETURNS TABLE exposes `id` as a PL/pgSQL variable, so every table column used
-- in the claim/update phase must be explicitly qualified.

create or replace function public.claim_notification_outbox_rows(p_limit integer default 50)
returns table(
  id uuid,
  event_key text,
  category text,
  entity_type text,
  entity_id uuid,
  minute_id uuid,
  actor_user_id uuid,
  recipient_id uuid,
  audience text,
  payload jsonb,
  attempt_count integer,
  notification_attempt_count integer,
  sms_attempt_count integer,
  idempotency_key text,
  notification_status text,
  sms_status text,
  sms_sent_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stuck_threshold timestamptz := now() - interval '5 minutes';
  v_claimed_ids uuid[];
begin
  select array_agg(sub.id)
    into v_claimed_ids
  from (
    select o.id
    from public.notification_outbox as o
    where (
      (o.status = 'pending' and o.next_attempt_at <= now())
      or
      (o.status = 'processing' and o.next_attempt_at < v_stuck_threshold)
      or
      (o.status = 'partial' and o.next_attempt_at is not null and o.next_attempt_at <= now())
      or
      (o.status = 'failed' and o.next_attempt_at is not null and o.next_attempt_at <= now())
    )
    order by o.created_at asc
    limit least(p_limit, 100)
    for update of o skip locked
  ) as sub;

  if v_claimed_ids is null or array_length(v_claimed_ids, 1) is null then
    return;
  end if;

  update public.notification_outbox as o
     set status = 'processing',
         next_attempt_at = now()
   where o.id = any(v_claimed_ids);

  return query
  select
    o.id,
    o.event_key,
    o.category,
    o.entity_type,
    o.entity_id,
    o.minute_id,
    o.actor_user_id,
    o.recipient_id,
    o.audience,
    o.payload,
    o.attempt_count,
    o.notification_attempt_count,
    o.sms_attempt_count,
    o.idempotency_key,
    o.notification_status,
    o.sms_status,
    o.sms_sent_at
  from public.notification_outbox as o
  where o.id = any(v_claimed_ids)
  order by o.created_at asc;
end;
$$;

revoke all on function public.claim_notification_outbox_rows(integer) from public;
revoke all on function public.claim_notification_outbox_rows(integer) from anon;
revoke all on function public.claim_notification_outbox_rows(integer) from authenticated;
grant execute on function public.claim_notification_outbox_rows(integer) to service_role;
