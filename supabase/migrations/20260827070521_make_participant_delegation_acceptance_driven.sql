create or replace function private.assign_meeting_invitation_delegate(
  p_meeting_inbox_id uuid,
  p_delegate_user_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_inbox public.meeting_inbox%rowtype;
  v_meeting record;
  v_delegate_org text;
  v_user_org text;
  v_delegate_name text;
  v_user_name text;
  v_inbox_updated_at timestamptz;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error_code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_inbox
  from public.meeting_inbox
  where id = p_meeting_inbox_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'INBOX_NOT_FOUND');
  end if;

  if v_inbox.user_id is distinct from v_user_id then
    return jsonb_build_object('success', false, 'error_code', 'NOT_INBOX_OWNER');
  end if;

  if p_delegate_user_id = v_user_id then
    return jsonb_build_object('success', false, 'error_code', 'CANNOT_DELEGATE_TO_SELF');
  end if;

  if v_inbox.status not in ('pending', 'accepted') then
    return jsonb_build_object('success', false, 'error_code', 'INBOX_NOT_PENDING');
  end if;

  if v_inbox.delegate_to is not null then
    return jsonb_build_object('success', false, 'error_code', 'DELEGATE_ALREADY_ASSIGNED');
  end if;

  v_inbox_updated_at := coalesce(v_inbox.updated_at, v_inbox.created_at);
  if p_expected_updated_at is null or p_expected_updated_at is distinct from v_inbox_updated_at then
    return jsonb_build_object('success', false, 'error_code', 'INBOX_VERSION_CONFLICT');
  end if;

  select id, user_id, subject, request_date, start_time, end_time, location,
         participant_user_ids, notify_users, calendar_id
  into v_meeting
  from public.meetings
  where id = v_inbox.meeting_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'MEETING_NOT_FOUND');
  end if;

  if v_inbox.status = 'accepted'
     and not (
       v_user_id = any(coalesce(v_meeting.participant_user_ids, '{}'::uuid[]))
       or v_user_id = any(coalesce(v_meeting.notify_users, '{}'::uuid[]))
     ) then
    return jsonb_build_object('success', false, 'error_code', 'ACCEPTED_INVITE_NOT_ON_CALENDAR');
  end if;

  if p_delegate_user_id = v_meeting.user_id then
    return jsonb_build_object('success', false, 'error_code', 'DELEGATE_IS_ORGANIZER');
  end if;

  if p_delegate_user_id = any(coalesce(v_meeting.participant_user_ids, '{}'::uuid[])) then
    return jsonb_build_object('success', false, 'error_code', 'DELEGATE_ALREADY_PARTICIPANT');
  end if;

  if exists (
    select 1
    from public.meeting_inbox
    where meeting_id = v_inbox.meeting_id
      and user_id = p_delegate_user_id
      and status in ('pending', 'accepted', 'delegated')
  ) then
    return jsonb_build_object('success', false, 'error_code', 'DELEGATE_ALREADY_INVITED');
  end if;

  select organization into v_delegate_org
  from public.profiles
  where user_id = p_delegate_user_id
    and is_active = true
    and coalesce(is_hidden, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'DELEGATE_PROFILE_INVALID');
  end if;

  select organization into v_user_org
  from public.profiles
  where user_id = v_user_id
  limit 1;

  if coalesce(v_user_org, '') <> coalesce(v_delegate_org, '') then
    return jsonb_build_object('success', false, 'error_code', 'DELEGATE_DIFFERENT_ORG');
  end if;

  v_user_name := coalesce(
    (select nullif(btrim(full_name), '') from public.profiles where user_id = v_user_id limit 1),
    'کاربر'
  );
  v_delegate_name := coalesce(
    (select nullif(btrim(full_name), '') from public.profiles where user_id = p_delegate_user_id limit 1),
    'جانشین'
  );

  update public.meeting_inbox
  set delegate_to = p_delegate_user_id,
      delegated_by_user_id = v_user_id,
      delegated_at = now(),
      updated_at = now()
  where id = p_meeting_inbox_id;

  insert into public.meeting_inbox (
    meeting_id,
    user_id,
    status,
    delegate_to,
    delegated_by_user_id,
    delegated_at
  )
  values (
    v_inbox.meeting_id,
    p_delegate_user_id,
    'pending',
    null,
    v_user_id,
    now()
  )
  on conflict (meeting_id, user_id) do update
  set status = 'pending',
      delegate_to = null,
      delegated_by_user_id = v_user_id,
      delegated_at = now(),
      updated_at = now();

  perform public.create_notification(
    p_user_id := p_delegate_user_id,
    p_title := 'درخواست جانشینی در جلسه',
    p_message := v_user_name || ' از شما درخواست کرده به‌عنوان جانشین او در جلسه «' ||
      coalesce(v_meeting.subject, '') || '» حضور داشته باشید. لطفاً از کارتابل جلسات تأیید یا رد کنید.',
    p_type := 'meeting',
    p_action_url := 'calendar',
    p_template_category := 'meeting',
    p_template_event_type := 'meeting_invitation_delegate_assigned',
    p_template_audience := 'all',
    p_entity_type := 'meeting',
    p_entity_id := v_inbox.meeting_id,
    p_metadata := jsonb_build_object(
      'meeting_id', v_inbox.meeting_id,
      'meeting_subject', coalesce(v_meeting.subject, ''),
      'meeting_date', coalesce(v_meeting.request_date, ''),
      'start_time', coalesce(v_meeting.start_time, ''),
      'end_time', coalesce(v_meeting.end_time, ''),
      'location', coalesce(v_meeting.location, ''),
      'represented_person_name', v_user_name,
      'representative_name', v_delegate_name,
      'recipient_greeting', v_delegate_name || ' گرامی',
      'full_name', v_delegate_name
    ),
    p_event_key := 'meeting:' || v_inbox.meeting_id::text || ':delegate-requested:' ||
      v_user_id::text || ':' || p_delegate_user_id::text || ':' || extract(epoch from now())::bigint::text
  );

  return jsonb_build_object(
    'success', true,
    'meeting_id', v_inbox.meeting_id,
    'delegate_user_id', p_delegate_user_id,
    'delegate_name', v_delegate_name,
    'status', 'pending',
    'message', 'درخواست جانشینی به کارتابل کاربر ارسال شد.'
  );
end;
$$;

create or replace function private.accept_meeting_invitation_v2(
  p_meeting_inbox_id uuid,
  p_allow_conflict boolean default false
)
returns table(accepted boolean, requires_confirmation boolean, meeting_id uuid, conflicts jsonb)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_caller uuid := auth.uid();
  v_inbox public.meeting_inbox%rowtype;
  v_meeting_id uuid;
  v_meeting_owner uuid;
  v_candidate_date timestamptz;
  v_candidate_day date;
  v_candidate_start text;
  v_candidate_end text;
  v_conflicts jsonb := '[]'::jsonb;
  v_delegator uuid;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_inbox
  from public.meeting_inbox mi
  where mi.id = p_meeting_inbox_id
    and mi.user_id = v_caller
  for update;

  if not found then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if v_inbox.status is distinct from 'pending' then
    raise exception 'INVALID_STATUS';
  end if;

  v_meeting_id := v_inbox.meeting_id;
  v_delegator := v_inbox.delegated_by_user_id;

  select m.user_id, m.request_date, m.start_time, m.end_time
  into v_meeting_owner, v_candidate_date, v_candidate_start, v_candidate_end
  from public.meetings m
  where m.id = v_meeting_id
  for update;

  if not found then
    raise exception 'MEETING_NOT_FOUND';
  end if;

  if v_candidate_start is not null and v_candidate_end is not null and v_candidate_date is not null then
    v_candidate_day := (v_candidate_date::timestamptz at time zone 'Asia/Tehran')::date;

    select coalesce(jsonb_agg(jsonb_build_object(
      'meeting_id', c.id,
      'title', c.subject,
      'meeting_date', c.request_date,
      'start_time', c.start_time,
      'end_time', c.end_time
    ) order by c.request_date, c.start_time), '[]'::jsonb)
    into v_conflicts
    from (
      select m.id, m.subject, m.request_date, m.start_time, m.end_time
      from public.meetings m
      where m.user_id = v_caller
        and m.id <> v_meeting_id
        and m.start_time is not null
        and m.end_time is not null
        and m.request_date is not null
        and (m.request_date::timestamptz at time zone 'Asia/Tehran')::date = v_candidate_day
        and m.start_time < v_candidate_end
        and v_candidate_start < m.end_time
      union
      select m.id, m.subject, m.request_date, m.start_time, m.end_time
      from public.meeting_inbox mi
      join public.meetings m on m.id = mi.meeting_id
      where mi.user_id = v_caller
        and mi.id <> p_meeting_inbox_id
        and m.id <> v_meeting_id
        and mi.status in ('pending', 'accepted')
        and m.start_time is not null
        and m.end_time is not null
        and m.request_date is not null
        and (m.request_date::timestamptz at time zone 'Asia/Tehran')::date = v_candidate_day
        and m.start_time < v_candidate_end
        and v_candidate_start < m.end_time
    ) c;
  end if;

  if jsonb_array_length(v_conflicts) > 0 and p_allow_conflict is not true then
    return query select false, true, v_meeting_id, v_conflicts;
    return;
  end if;

  update public.meeting_inbox
  set status = 'accepted',
      updated_at = now()
  where id = v_inbox.id
    and user_id = v_caller;

  if v_delegator is not null then
    update public.meetings m
    set participant_user_ids = array(
          select distinct x.user_id
          from (
            select unnest(coalesce(m.participant_user_ids, '{}'::uuid[])) as user_id
            union all
            select v_caller
          ) x
          where x.user_id is not null
            and (v_delegator = v_meeting_owner or x.user_id is distinct from v_delegator)
        ),
        notify_users = case
          when v_delegator = v_meeting_owner then m.notify_users
          else array(
            select x.user_id
            from unnest(coalesce(m.notify_users, '{}'::uuid[])) x(user_id)
            where x.user_id is distinct from v_delegator
          )
        end
    where m.id = v_meeting_id;

    if v_delegator is distinct from v_meeting_owner then
      update public.meeting_inbox
      set status = 'delegated',
          delegate_to = v_caller,
          delegated_by_user_id = v_delegator,
          delegated_at = coalesce(delegated_at, now()),
          updated_at = now()
      where meeting_id = v_meeting_id
        and user_id = v_delegator;
    end if;
  end if;

  return query
  select true, false, v_meeting_id,
    case when jsonb_array_length(v_conflicts) > 0 then v_conflicts else '[]'::jsonb end;
end;
$$;

create or replace function private.decline_meeting_invitation_v2(
  p_meeting_inbox_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inbox public.meeting_inbox%rowtype;
  v_owner uuid;
  v_delegator uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  select * into v_inbox
  from public.meeting_inbox mi
  where mi.id = p_meeting_inbox_id
    and mi.user_id = v_uid
  for update;

  if not found then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  if v_inbox.status is distinct from 'pending' then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_STATUS');
  end if;

  select m.user_id into v_owner
  from public.meetings m
  where m.id = v_inbox.meeting_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'MEETING_NOT_FOUND');
  end if;

  v_delegator := v_inbox.delegated_by_user_id;

  update public.meeting_inbox
  set status = 'declined',
      updated_at = now()
  where id = v_inbox.id;

  if v_delegator is not null then
    update public.meeting_inbox
    set delegate_to = null,
        delegated_by_user_id = null,
        delegated_at = null,
        updated_at = now()
    where meeting_id = v_inbox.meeting_id
      and user_id = v_delegator;
  else
    update public.meetings
    set status_type = 'rejected'
    where id = v_inbox.meeting_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'meeting_id', v_inbox.meeting_id,
    'delegate_request', v_delegator is not null,
    'delegator_user_id', v_delegator,
    'organizer_user_id', v_owner
  );
end;
$$;

create or replace function private.get_my_meeting_delegations_v1()
returns table(
  meeting_id uuid,
  delegate_user_id uuid,
  delegate_name text,
  status text,
  delegated_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $$
  select distinct on (mi.meeting_id)
    mi.meeting_id,
    mi.user_id as delegate_user_id,
    coalesce(nullif(btrim(p.full_name), ''), p.username, mi.user_id::text) as delegate_name,
    mi.status::text,
    mi.delegated_at,
    mi.updated_at
  from public.meeting_inbox mi
  left join public.profiles p on p.user_id = mi.user_id
  where auth.uid() is not null
    and private.is_current_session_fully_authorized()
    and mi.delegated_by_user_id = auth.uid()
    and mi.user_id is distinct from auth.uid()
  order by mi.meeting_id,
           coalesce(mi.updated_at, mi.delegated_at, mi.created_at) desc,
           mi.created_at desc
$$;

create or replace function public.get_my_meeting_delegations_v1()
returns table(
  meeting_id uuid,
  delegate_user_id uuid,
  delegate_name text,
  status text,
  delegated_at timestamptz,
  updated_at timestamptz
)
language sql
stable
set search_path to ''
as $$
  select * from private.get_my_meeting_delegations_v1()
$$;

revoke all on function private.get_my_meeting_delegations_v1() from public;
revoke all on function public.get_my_meeting_delegations_v1() from public, anon;
grant execute on function public.get_my_meeting_delegations_v1() to authenticated;

notify pgrst, 'reload schema';
