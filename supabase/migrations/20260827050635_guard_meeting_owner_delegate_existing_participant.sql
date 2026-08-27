create or replace function private.assign_meeting_owner_delegate(
  p_meeting_id uuid,
  p_delegate_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_meeting record;
  v_owner_org text;
  v_delegate_org text;
  v_owner_name text;
  v_delegate_name text;
  v_existing public.meeting_inbox%rowtype;
  v_has_existing boolean := false;
  v_next_participants uuid[];
  v_metadata jsonb;
begin
  if v_uid is null or not private.is_current_session_fully_authorized() then
    raise exception 'AUTH_ACCESS_RESTRICTED' using errcode='42501';
  end if;

  select
    m.id, m.user_id, m.subject, m.request_date, m.start_time, m.end_time,
    m.location, m.calendar_id, m.participant_user_ids, m.notify_users
  into v_meeting
  from public.meetings m
  where m.id = p_meeting_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'MEETING_NOT_FOUND');
  end if;

  if v_meeting.user_id is distinct from v_uid then
    return jsonb_build_object('success', false, 'error_code', 'NOT_MEETING_OWNER');
  end if;

  if p_delegate_user_id is null or p_delegate_user_id = v_uid then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_DELEGATE');
  end if;

  select p.organization, coalesce(nullif(btrim(p.full_name), ''), 'سازنده جلسه')
    into v_owner_org, v_owner_name
  from public.profiles p
  where p.user_id = v_uid
  limit 1;

  select p.organization, coalesce(nullif(btrim(p.full_name), ''), 'جانشین')
    into v_delegate_org, v_delegate_name
  from public.profiles p
  where p.user_id = p_delegate_user_id
    and p.is_active = true
    and coalesce(p.is_hidden, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'DELEGATE_PROFILE_INVALID');
  end if;

  if coalesce(v_owner_org, '') <> coalesce(v_delegate_org, '') then
    return jsonb_build_object('success', false, 'error_code', 'DELEGATE_DIFFERENT_ORG');
  end if;

  select *
    into v_existing
  from public.meeting_inbox mi
  where mi.meeting_id = p_meeting_id
    and mi.user_id = p_delegate_user_id
  for update;
  v_has_existing := found;

  if v_has_existing and v_existing.status in ('pending', 'accepted', 'delegated') then
    return jsonb_build_object('success', false, 'error_code', 'DELEGATE_ALREADY_INVITED');
  end if;

  if (
    (
      p_delegate_user_id = any(coalesce(v_meeting.participant_user_ids, '{}'::uuid[]))
      or p_delegate_user_id = any(coalesce(v_meeting.notify_users, '{}'::uuid[]))
    )
    and not (v_has_existing and v_existing.status = 'declined')
  ) then
    return jsonb_build_object('success', false, 'error_code', 'DELEGATE_ALREADY_INVITED');
  end if;

  if v_has_existing then
    update public.meeting_inbox
    set status = 'pending',
        delegate_to = null,
        delegated_by_user_id = v_uid,
        delegated_at = now(),
        updated_at = now()
    where id = v_existing.id;
  else
    insert into public.meeting_inbox (
      meeting_id, user_id, status, delegate_to,
      delegated_by_user_id, delegated_at
    )
    values (
      p_meeting_id, p_delegate_user_id, 'pending', null,
      v_uid, now()
    );
  end if;

  v_next_participants := array(
    select distinct q.user_id
    from (
      select unnest(coalesce(v_meeting.participant_user_ids, '{}'::uuid[])) as user_id
      union all
      select p_delegate_user_id
    ) q
    where q.user_id is not null
  );

  update public.meetings
  set participant_user_ids = v_next_participants
  where id = p_meeting_id;

  v_metadata := jsonb_build_object(
    'meeting_id', p_meeting_id,
    'meeting_subject', coalesce(v_meeting.subject, ''),
    'meeting_date', coalesce(v_meeting.request_date, ''),
    'start_time', coalesce(v_meeting.start_time, ''),
    'end_time', coalesce(v_meeting.end_time, ''),
    'meeting_time', concat_ws(' - ', nullif(v_meeting.start_time, ''), nullif(v_meeting.end_time, '')),
    'location', coalesce(v_meeting.location, ''),
    'represented_person_name', v_owner_name,
    'representative_name', v_delegate_name,
    'organizer_name', v_owner_name,
    'calendar_id', v_meeting.calendar_id,
    'meeting_link', coalesce(v_meeting.calendar_id::text, ''),
    'recipient_greeting', v_delegate_name || ' گرامی',
    'full_name', v_delegate_name
  );

  perform public.create_notification(
    p_user_id := p_delegate_user_id,
    p_title := 'درخواست جانشینی در جلسه',
    p_message := v_owner_name || ' شما را به‌عنوان جانشین خود برای جلسه «' || coalesce(v_meeting.subject, '') || '» انتخاب کرده است. لطفاً از کارتابل جلسات پاسخ دهید.',
    p_type := 'meeting',
    p_action_url := 'calendar',
    p_template_category := 'meeting',
    p_template_event_type := 'meeting_invitation_delegate_assigned',
    p_template_audience := 'all',
    p_entity_type := 'meeting',
    p_entity_id := p_meeting_id,
    p_metadata := v_metadata,
    p_event_key := 'meeting:' || p_meeting_id::text || ':owner-delegate-requested:' || p_delegate_user_id::text
  );

  return jsonb_build_object(
    'success', true,
    'meeting_id', p_meeting_id,
    'delegate_user_id', p_delegate_user_id,
    'delegate_name', v_delegate_name
  );
end;
$$;

notify pgrst, 'reload schema';
