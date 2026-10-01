-- Scope Minutes/Decisions dashboard counters to the current user's real work.
-- This intentionally does not change RLS or management visibility/list RPCs.
-- It only fixes aggregate/count semantics so broad view permissions do not inflate badges/cards.

create or replace function private.get_trackable_minutes_decisions_summary()
returns table(
  total_count integer,
  active_count integer,
  completed_count integer,
  stopped_count integer,
  overdue_count integer,
  open_obstacle_count integer,
  requires_followup_count integer
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tehran')::date;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  return query
  select
    count(distinct d.id)::integer,
    count(distinct d.id) filter (
      where d.status in ('not_started','planned','in_progress','waiting_coordination','waiting_approval')
    )::integer,
    count(distinct d.id) filter (where d.status = 'completed')::integer,
    count(distinct d.id) filter (where d.status = 'stopped')::integer,
    count(distinct d.id) filter (
      where d.due_date is not null
        and d.due_date < v_today
        and d.status not in ('completed','stopped')
    )::integer,
    count(distinct d.id) filter (
      where exists (
        select 1
        from public.minutes_decision_updates u
        where u.decision_id = d.id
          and u.is_blocking = true
          and u.resolved_at is null
      )
    )::integer,
    count(distinct d.id) filter (
      where d.requires_followup = true
        and d.status not in ('completed','stopped')
    )::integer
  from public.minutes_decisions d
  where d.primary_owner_user_id = v_user_id
    and public._user_can_view_minute(d.minute_id)
    -- A parent that has child clauses is structural; count executable leaf rows only.
    and (
      d.parent_decision_id is not null
      or not exists (
        select 1
        from public.minutes_decisions c
        where c.parent_decision_id = d.id
      )
    );
end;
$function$;

create or replace function private.get_minutes_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tehran')::date;
  v_total int;
  v_draft int;
  v_pending int;
  v_changes int;
  v_approved int;
  v_published int;
  v_open_dec int;
  v_overdue int;
  v_pending_my int;
  v_status_counts jsonb;
  v_dec_status_counts jsonb;
  v_created_30 int;
  v_near_deadline int;
  v_top_units jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  -- "My minutes" means the user has an explicit operational relationship to the
  -- minute. Admin/global view permission alone must not inflate personal counters.
  with my_minutes as (
    select m.*
    from public.minutes m
    where public._user_can_view_minute(m.id)
      and (
        m.created_by_user_id = v_uid
        or m.secretary_user_id = v_uid
        or m.chair_user_id = v_uid
        or exists (
          select 1
          from public.minutes_participants mp
          where mp.minute_id = m.id
            and mp.user_id = v_uid
        )
        or exists (
          select 1
          from public.minutes_approvals ma
          where ma.minute_id = m.id
            and ma.revision_number = m.revision_number
            and (ma.approver_user_id = v_uid or ma.delegate_user_id = v_uid)
        )
        or exists (
          select 1
          from public.minutes_decisions md
          where md.minute_id = m.id
            and md.primary_owner_user_id = v_uid
        )
      )
  )
  select
    count(*),
    count(*) filter (where status = 'draft'),
    count(*) filter (where status = 'pending_approval'),
    count(*) filter (where status = 'changes_requested'),
    count(*) filter (where status = 'approved'),
    count(*) filter (where status = 'published')
  into v_total, v_draft, v_pending, v_changes, v_approved, v_published
  from my_minutes;

  -- Decision cards are personal work counters, not every decision from a minute
  -- the user can merely view or administratively track.
  with my_decisions as (
    select d.*
    from public.minutes_decisions d
    where d.primary_owner_user_id = v_uid
      and public._user_can_view_minute(d.minute_id)
      and (
        d.parent_decision_id is not null
        or not exists (
          select 1
          from public.minutes_decisions c
          where c.parent_decision_id = d.id
        )
      )
  )
  select
    count(*) filter (
      where status in ('not_started','planned','in_progress','waiting_coordination','waiting_approval')
    ),
    count(*) filter (
      where due_date is not null
        and due_date < v_today
        and status not in ('completed','stopped')
    )
  into v_open_dec, v_overdue
  from my_decisions;

  -- Approval/signature badge: only the current revision and only an action that
  -- belongs to the current user (directly or as delegate).
  select count(*)
  into v_pending_my
  from public.minutes_approvals a
  join public.minutes m on m.id = a.minute_id
  where a.status = 'pending'
    and (a.approver_user_id = v_uid or a.delegate_user_id = v_uid)
    and a.revision_number = m.revision_number
    and m.status = 'pending_approval'
    and public._user_can_view_minute(a.minute_id);

  with my_minutes as (
    select m.id, m.status
    from public.minutes m
    where public._user_can_view_minute(m.id)
      and (
        m.created_by_user_id = v_uid
        or m.secretary_user_id = v_uid
        or m.chair_user_id = v_uid
        or exists (
          select 1 from public.minutes_participants mp
          where mp.minute_id = m.id and mp.user_id = v_uid
        )
        or exists (
          select 1 from public.minutes_approvals ma
          where ma.minute_id = m.id
            and ma.revision_number = m.revision_number
            and (ma.approver_user_id = v_uid or ma.delegate_user_id = v_uid)
        )
        or exists (
          select 1 from public.minutes_decisions md
          where md.minute_id = m.id and md.primary_owner_user_id = v_uid
        )
      )
  )
  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
  into v_status_counts
  from (
    select status, count(*) cnt
    from my_minutes
    group by status
  ) s;

  with my_decisions as (
    select d.id, d.status
    from public.minutes_decisions d
    where d.primary_owner_user_id = v_uid
      and public._user_can_view_minute(d.minute_id)
      and (
        d.parent_decision_id is not null
        or not exists (
          select 1 from public.minutes_decisions c
          where c.parent_decision_id = d.id
        )
      )
  )
  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
  into v_dec_status_counts
  from (
    select status, count(*) cnt
    from my_decisions
    group by status
  ) s;

  select count(*)
  into v_created_30
  from public.minutes m
  where m.created_at >= now() - interval '30 days'
    and public._user_can_view_minute(m.id)
    and (
      m.created_by_user_id = v_uid
      or m.secretary_user_id = v_uid
      or m.chair_user_id = v_uid
      or exists (
        select 1 from public.minutes_participants mp
        where mp.minute_id = m.id and mp.user_id = v_uid
      )
      or exists (
        select 1 from public.minutes_approvals ma
        where ma.minute_id = m.id
          and ma.revision_number = m.revision_number
          and (ma.approver_user_id = v_uid or ma.delegate_user_id = v_uid)
      )
      or exists (
        select 1 from public.minutes_decisions md
        where md.minute_id = m.id and md.primary_owner_user_id = v_uid
      )
    );

  select count(*)
  into v_near_deadline
  from public.minutes_decisions d
  where d.primary_owner_user_id = v_uid
    and public._user_can_view_minute(d.minute_id)
    and (
      d.parent_decision_id is not null
      or not exists (
        select 1 from public.minutes_decisions c
        where c.parent_decision_id = d.id
      )
    )
    and d.due_date between v_today and v_today + 7
    and d.status not in ('completed','stopped');

  select coalesce(
    jsonb_agg(jsonb_build_object('unit', unit, 'open_decisions', open_dec)),
    '[]'::jsonb
  )
  into v_top_units
  from (
    select coalesce(m.org_unit_name_snapshot, '—') unit, count(*) open_dec
    from public.minutes_decisions d
    join public.minutes m on m.id = d.minute_id
    where d.primary_owner_user_id = v_uid
      and public._user_can_view_minute(d.minute_id)
      and (
        d.parent_decision_id is not null
        or not exists (
          select 1 from public.minutes_decisions c
          where c.parent_decision_id = d.id
        )
      )
      and d.status in ('not_started','planned','in_progress','waiting_coordination','waiting_approval')
    group by m.org_unit_name_snapshot
    order by open_dec desc
    limit 5
  ) t;

  return jsonb_build_object(
    'total_minutes', v_total,
    'draft', v_draft,
    'pending_approval', v_pending,
    'changes_requested', v_changes,
    'approved', v_approved,
    'published', v_published,
    'open_decisions', v_open_dec,
    'overdue_decisions', v_overdue,
    'pending_my_approval', v_pending_my,
    'status_counts', v_status_counts,
    'decision_status_counts', v_dec_status_counts,
    'created_last_30', v_created_30,
    'decisions_near_deadline', v_near_deadline,
    'top_units', v_top_units
  );
end;
$function$;
