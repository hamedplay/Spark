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
  v_active record;
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

  if p_delegate_user_id = any(coalesce(v_meeting.participant_user_ids, '{}'::uuid[]))
     or p_delegate_user_id = any(coalesce(v_meeting.notify_users, '{}'::uuid[])) then
    return jsonb_build_object('success', false, 'error_code', 'DELEGATE_ALREADY_INVITED');
  end if;

  select mi.user_id, mi.status
  into v_active
  from public.meeting_inbox mi
  where mi.meeting_id = p_meeting_id
    and mi.delegated_by_user_id = v_uid
    and mi.status in ('pending', 'accepted')
  order by coalesce(mi.updated_at, mi.delegated_at, mi.created_at) desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'success', false,
      'error_code', case when v_active.status = 'accepted'
        then 'OWNER_DELEGATE_ALREADY_ACCEPTED'
        else 'OWNER_DELEGATE_ALREADY_PENDING'
      end,
      'delegate_user_id', v_active.user_id,
      'status', v_active.status
    );
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
    p_message := v_owner_name || ' از شما درخواست کرده به‌عنوان جانشین او در جلسه «' || coalesce(v_meeting.subject, '') || '» حضور داشته باشید. لطفاً از کارتابل جلسات تأیید یا رد کنید.',
    p_type := 'meeting',
    p_action_url := 'calendar',
    p_template_category := 'meeting',
    p_template_event_type := 'meeting_invitation_delegate_assigned',
    p_template_audience := 'all',
    p_entity_type := 'meeting',
    p_entity_id := p_meeting_id,
    p_metadata := v_metadata,
    p_event_key := 'meeting:' || p_meeting_id::text || ':owner-delegate-requested:' || p_delegate_user_id::text || ':' || extract(epoch from now())::bigint::text
  );

  return jsonb_build_object(
    'success', true,
    'meeting_id', p_meeting_id,
    'delegate_user_id', p_delegate_user_id,
    'delegate_name', v_delegate_name,
    'status', 'pending'
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

  update public.meeting_inbox mi
  set status = 'accepted',
      updated_at = now()
  where mi.id = v_inbox.id
    and mi.user_id = v_caller;

  if v_inbox.delegated_by_user_id is not null
     and v_inbox.delegated_by_user_id = v_meeting_owner then
    update public.meetings m
    set participant_user_ids = array(
      select distinct x.user_id
      from (
        select unnest(coalesce(m.participant_user_ids, '{}'::uuid[])) as user_id
        union all
        select v_caller
      ) x
      where x.user_id is not null
    )
    where m.id = v_meeting_id;
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
  v_is_owner_delegate boolean := false;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  select *
  into v_inbox
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

  select m.user_id
  into v_owner
  from public.meetings m
  where m.id = v_inbox.meeting_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'MEETING_NOT_FOUND');
  end if;

  v_is_owner_delegate := (
    v_inbox.delegated_by_user_id is not null
    and v_inbox.delegated_by_user_id = v_owner
  );

  update public.meeting_inbox
  set status = 'declined',
      updated_at = now()
  where id = v_inbox.id;

  if v_is_owner_delegate then
    update public.meetings m
    set participant_user_ids = array(
      select x.user_id
      from unnest(coalesce(m.participant_user_ids, '{}'::uuid[])) x(user_id)
      where x.user_id is distinct from v_uid
    )
    where m.id = v_inbox.meeting_id;
  else
    update public.meetings
    set status_type = 'rejected'
    where id = v_inbox.meeting_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'meeting_id', v_inbox.meeting_id,
    'owner_delegate', v_is_owner_delegate,
    'organizer_user_id', v_owner
  );
end;
$$;

create or replace function public.decline_meeting_invitation_v2(
  p_meeting_inbox_id uuid
)
returns jsonb
language sql
set search_path to ''
as $$
  select private.decline_meeting_invitation_v2($1::uuid)
$$;

revoke all on function private.decline_meeting_invitation_v2(uuid) from public;
revoke all on function public.decline_meeting_invitation_v2(uuid) from public, anon;
grant execute on function public.decline_meeting_invitation_v2(uuid) to authenticated;

create or replace function private.get_my_meeting_owner_delegations_v1()
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
  join public.meetings m on m.id = mi.meeting_id
  left join public.profiles p on p.user_id = mi.user_id
  where auth.uid() is not null
    and private.is_current_session_fully_authorized()
    and m.user_id = auth.uid()
    and mi.delegated_by_user_id = auth.uid()
  order by mi.meeting_id,
           coalesce(mi.updated_at, mi.delegated_at, mi.created_at) desc,
           mi.created_at desc
$$;

create or replace function public.get_my_meeting_owner_delegations_v1()
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
  select * from private.get_my_meeting_owner_delegations_v1()
$$;

revoke all on function private.get_my_meeting_owner_delegations_v1() from public;
revoke all on function public.get_my_meeting_owner_delegations_v1() from public, anon;
grant execute on function public.get_my_meeting_owner_delegations_v1() to authenticated;

with legacy as (
  select mi.meeting_id, mi.user_id
  from public.meeting_inbox mi
  join public.meetings m on m.id = mi.meeting_id
  where mi.delegated_by_user_id = m.user_id
    and mi.status in ('pending', 'declined')
)
update public.meetings m
set participant_user_ids = array(
  select x.user_id
  from unnest(coalesce(m.participant_user_ids, '{}'::uuid[])) x(user_id)
  where not exists (
    select 1
    from legacy l
    where l.meeting_id = m.id
      and l.user_id = x.user_id
  )
)
where exists (
  select 1 from legacy l where l.meeting_id = m.id
);

notify pgrst, 'reload schema';
