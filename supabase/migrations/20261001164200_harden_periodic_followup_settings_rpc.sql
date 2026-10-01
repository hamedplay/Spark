-- Keep the exposed RPC security-invoker and place privileged access behind the
-- private schema, matching the existing minutes RPC pattern.

create or replace function private.get_minutes_decision_periodic_settings(p_decision_ids uuid[])
returns table(
  decision_id uuid,
  followup_recurrence text,
  followup_recipient_type text,
  next_periodic_followup_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id,
         d.followup_recurrence,
         d.followup_recipient_type,
         d.next_periodic_followup_at
    from public.minutes_decisions d
   where d.id = any(coalesce(p_decision_ids, '{}'::uuid[]))
     and public._user_can_view_minute(d.minute_id)
$$;

revoke all on function private.get_minutes_decision_periodic_settings(uuid[]) from public, anon;
grant execute on function private.get_minutes_decision_periodic_settings(uuid[]) to authenticated, service_role;

create or replace function public.get_minutes_decision_periodic_settings(p_decision_ids uuid[])
returns table(
  decision_id uuid,
  followup_recurrence text,
  followup_recipient_type text,
  next_periodic_followup_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_minutes_decision_periodic_settings(p_decision_ids)
$$;

revoke all on function public.get_minutes_decision_periodic_settings(uuid[]) from public, anon;
grant execute on function public.get_minutes_decision_periodic_settings(uuid[]) to authenticated, service_role;
