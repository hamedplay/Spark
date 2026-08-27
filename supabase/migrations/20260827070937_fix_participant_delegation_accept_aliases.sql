create or replace function private.accept_meeting_invitation_v2(
  p_meeting_inbox_id uuid,
  p_allow_conflict boolean default false
)
returns table(
  accepted boolean,
  requires_confirmation boolean,
  meeting_id uuid,
  conflicts jsonb
)
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

  select *
  into v_inbox
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

  update public.meeting_inbox mi_accept
  set status = 'accepted',
      updated_at = now()
  where mi_accept.id = v_inbox.id
    and mi_accept.user_id = v_caller;

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
      update public.meeting_inbox mi_delegator
      set status = 'delegated',
          delegate_to = v_caller,
          delegated_by_user_id = v_delegator,
          delegated_at = coalesce(mi_delegator.delegated_at, now()),
          updated_at = now()
      where mi_delegator.meeting_id = v_meeting_id
        and mi_delegator.user_id = v_delegator;
    end if;
  end if;

  return query
  select true, false, v_meeting_id,
    case when jsonb_array_length(v_conflicts) > 0 then v_conflicts else '[]'::jsonb end;
end;
$$;

notify pgrst, 'reload schema';
