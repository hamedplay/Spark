-- Align personal calendar exclusion authorization with the existing monitoring SELECT policy.
-- Users with config_modules.monitoring can legitimately read meetings through
-- config_monitoring_meetings_select. Removing a meeting from their own calendar only
-- writes a per-user exclusion and does not mutate the meeting or its membership.

create or replace function private.remove_self_from_meeting(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_subject text;
  v_authorized boolean := false;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select
    m.subject,
    (
      m.user_id = v_user_id
      or m.meeting_manager = v_user_id
      or v_user_id = any(coalesce(m.participant_user_ids, '{}'::uuid[]))
      or v_user_id = any(coalesce(m.notify_users, '{}'::uuid[]))
      or exists (
        select 1
        from public.meeting_inbox mi
        where mi.meeting_id = m.id
          and mi.user_id = v_user_id
      )
      or exists (
        select 1
        from public.calendar_subscriptions cs
        where cs.calendar_id = m.calendar_id
          and cs.user_id = v_user_id
      )
      or (
        m.calendar_id is null
        and not coalesce(m.members_only, false)
        and private.is_any_participant_calendar_subscribed(
          array_prepend(m.user_id, coalesce(m.participant_user_ids, '{}'::uuid[]))
        )
      )
      or private.current_user_has_permission_v1('config_modules.monitoring'::text)
    )
  into v_subject, v_authorized
  from public.meetings m
  where m.id = p_meeting_id;

  if not found then
    raise exception 'MEETING_NOT_FOUND';
  end if;

  if not coalesce(v_authorized, false) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  insert into public.meeting_calendar_exclusions (meeting_id, user_id, hidden_at)
  values (p_meeting_id, v_user_id, now())
  on conflict (meeting_id, user_id)
  do update set hidden_at = excluded.hidden_at;

  insert into public.audit_log (
    user_id,
    module,
    entity_name,
    entity_id,
    action,
    details,
    severity,
    created_at
  )
  values (
    v_user_id,
    'calendar',
    coalesce(v_subject, 'meeting'),
    p_meeting_id::text,
    'remove_from_personal_calendar',
    'Meeting removed from the current user personal calendar only',
    'info',
    now()
  );
end;
$function$;
