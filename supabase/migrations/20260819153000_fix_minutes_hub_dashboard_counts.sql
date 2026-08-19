-- Align Minutes Hub/dashboard counters with the canonical destination-page semantics.
-- Scope: counters only. No table/schema shape changes and no historical migration edits.

create or replace function private.get_my_minutes_hub_counts()
returns json
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_minutes_unread int;
  v_approvals_pending int;
  v_my_decisions_unread int;
  v_my_decisions_active int;
  v_followup_actionable int;
  v_minutes_total int;
  v_minutes_open int;
  v_minutes_closed int;
  v_approvals_total int;
  v_approvals_open int;
  v_approvals_closed int;
  v_my_decisions_total int;
  v_my_decisions_open int;
  v_my_decisions_closed int;
  v_followup_total int;
  v_followup_open int;
  v_followup_closed int;
  v_dash_minutes_total int;
  v_dash_minutes_open int;
  v_dash_minutes_closed int;
  v_dash_decisions_total int;
  v_dash_decisions_open int;
  v_dash_decisions_closed int;
  v_reports_total int;
  v_reports_open int;
  v_reports_closed int;
begin
  if v_user_id is null then
    return json_build_object(
      'minutes_unread',0,'approvals_pending',0,'my_decisions_unread',0,'my_decisions_active',0,
      'followup_actionable',0,'minutes_total',0,'minutes_open',0,'minutes_closed',0,
      'approvals_total',0,'approvals_open',0,'approvals_closed',0,
      'my_decisions_total',0,'my_decisions_open',0,'my_decisions_closed',0,
      'followup_total',0,'followup_open',0,'followup_closed',0,
      'dashboard_minutes_total',0,'dashboard_minutes_open',0,'dashboard_minutes_closed',0,
      'dashboard_decisions_total',0,'dashboard_decisions_open',0,'dashboard_decisions_closed',0,
      'reports_total',0,'reports_open',0,'reports_closed',0
    );
  end if;

  select count(*) into v_minutes_unread
  from public.notifications
  where user_id = v_user_id and read = false
    and (template_category = 'minutes' or (template_category is null and entity_type = 'minute'));

  -- The approvals destination page is an inbox: count only actionable rows that
  -- belong to the current revision, including delegated approvals.
  select count(*) into v_approvals_pending
  from public.minutes_approvals ma
  join public.minutes m on m.id = ma.minute_id
  where (ma.approver_user_id = v_user_id or ma.delegate_user_id = v_user_id)
    and ma.status = 'pending'
    and ma.revision_number = m.revision_number
    and m.status = 'pending_approval';

  v_approvals_total := v_approvals_pending;
  v_approvals_open := v_approvals_pending;
  v_approvals_closed := 0;

  select count(*) into v_my_decisions_unread
  from public.notifications
  where user_id = v_user_id and read = false
    and (template_category = 'decision' or (template_category is null and entity_type = 'decision'));

  -- Reuse the exact summary semantics used by MyDecisionsPage.
  select
    coalesce(s.total_count, 0),
    coalesce(s.active_count, 0),
    coalesce(s.completed_count, 0) + coalesce(s.stopped_count, 0)
  into v_my_decisions_total, v_my_decisions_open, v_my_decisions_closed
  from private.get_my_minutes_decisions_summary() s;

  v_my_decisions_active := v_my_decisions_open;

  -- Reuse the exact summary semantics used by DecisionsFollowupPage.
  -- The top KPI now means what its label says: decisions explicitly marked as
  -- requiring follow-up, rather than a separate reminder/overdue-only formula.
  select
    coalesce(s.total_count, 0),
    coalesce(s.active_count, 0),
    coalesce(s.completed_count, 0) + coalesce(s.stopped_count, 0),
    coalesce(s.requires_followup_count, 0)
  into v_followup_total, v_followup_open, v_followup_closed, v_followup_actionable
  from private.get_trackable_minutes_decisions_summary() s;

  select count(*),
         count(*) filter (where m.status <> 'published'),
         count(*) filter (where m.status = 'published')
    into v_minutes_total, v_minutes_open, v_minutes_closed
  from public.minutes m
  where public._user_can_view_minute(m.id);

  -- Dashboard-card minute counts use the same visible-minute population.
  v_dash_minutes_total := v_minutes_total;
  v_dash_minutes_open := v_minutes_open;
  v_dash_minutes_closed := v_minutes_closed;

  select count(*),
         count(*) filter (where d.status in ('not_started','planned','in_progress','waiting_coordination','waiting_approval')),
         count(*) filter (where d.status in ('completed','stopped'))
    into v_dash_decisions_total, v_dash_decisions_open, v_dash_decisions_closed
  from public.minutes_decisions d
  where d.parent_decision_id is null
    and public._user_can_view_minute(d.minute_id);

  -- MinutesReportsPage defaults to an unfiltered minutes report, so its hub
  -- counters must include every visible minute (not published minutes only).
  v_reports_total := v_minutes_total;
  v_reports_open := v_minutes_open;
  v_reports_closed := v_minutes_closed;

  return json_build_object(
    'minutes_unread',v_minutes_unread,'approvals_pending',v_approvals_pending,
    'my_decisions_unread',v_my_decisions_unread,'my_decisions_active',v_my_decisions_active,
    'followup_actionable',v_followup_actionable,
    'minutes_total',v_minutes_total,'minutes_open',v_minutes_open,'minutes_closed',v_minutes_closed,
    'approvals_total',v_approvals_total,'approvals_open',v_approvals_open,'approvals_closed',v_approvals_closed,
    'my_decisions_total',v_my_decisions_total,'my_decisions_open',v_my_decisions_open,'my_decisions_closed',v_my_decisions_closed,
    'followup_total',v_followup_total,'followup_open',v_followup_open,'followup_closed',v_followup_closed,
    'dashboard_minutes_total',v_dash_minutes_total,'dashboard_minutes_open',v_dash_minutes_open,'dashboard_minutes_closed',v_dash_minutes_closed,
    'dashboard_decisions_total',v_dash_decisions_total,'dashboard_decisions_open',v_dash_decisions_open,'dashboard_decisions_closed',v_dash_decisions_closed,
    'reports_total',v_reports_total,'reports_open',v_reports_open,'reports_closed',v_reports_closed
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
  v_total int; v_draft int; v_pending int; v_changes int; v_approved int; v_published int;
  v_open_dec int; v_overdue int; v_pending_my int;
  v_status_counts jsonb; v_dec_status_counts jsonb; v_created_30 int;
  v_near_deadline int; v_top_units jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;

  select count(*),
         count(*) filter (where status='draft'),
         count(*) filter (where status='pending_approval'),
         count(*) filter (where status='changes_requested'),
         count(*) filter (where status='approved'),
         count(*) filter (where status='published')
    into v_total, v_draft, v_pending, v_changes, v_approved, v_published
  from public.minutes m
  where public._user_can_view_minute(m.id);

  select count(*) filter (where d.status in ('not_started','planned','in_progress','waiting_coordination','waiting_approval')),
         count(*) filter (where (
           (not exists (select 1 from public.minutes_decisions c where c.parent_decision_id=d.id)
             and d.due_date < v_today and d.status not in ('completed','stopped'))
           or exists (
             select 1 from public.minutes_decisions c
             where c.parent_decision_id=d.id
               and c.due_date < v_today and c.status not in ('completed','stopped')
           )
         ))
    into v_open_dec, v_overdue
  from public.minutes_decisions d
  where d.parent_decision_id is null
    and public._user_can_view_minute(d.minute_id);

  -- Match the approval inbox, including delegated approvals and only the
  -- current pending revision.
  select count(*) into v_pending_my
  from public.minutes_approvals a
  join public.minutes m on m.id = a.minute_id
  where a.status='pending'
    and (a.approver_user_id=v_uid or a.delegate_user_id=v_uid)
    and a.revision_number = m.revision_number
    and m.status = 'pending_approval'
    and public._user_can_view_minute(a.minute_id);

  select coalesce(jsonb_object_agg(status,cnt),'{}'::jsonb)
    into v_status_counts
  from (
    select status,count(*) cnt
    from public.minutes
    where public._user_can_view_minute(id)
    group by status
  ) s;

  select coalesce(jsonb_object_agg(status,cnt),'{}'::jsonb)
    into v_dec_status_counts
  from (
    select d.status,count(*) cnt
    from public.minutes_decisions d
    where d.parent_decision_id is null
      and public._user_can_view_minute(d.minute_id)
    group by d.status
  ) s;

  select count(*) into v_created_30
  from public.minutes
  where created_at >= now()-interval '30 days'
    and public._user_can_view_minute(id);

  select count(*) into v_near_deadline
  from public.minutes_decisions d
  where d.parent_decision_id is null
    and public._user_can_view_minute(d.minute_id)
    and (
      (not exists (select 1 from public.minutes_decisions c where c.parent_decision_id=d.id)
       and d.due_date between v_today and v_today + 7
       and d.status not in ('completed','stopped'))
      or exists (
        select 1 from public.minutes_decisions c
        where c.parent_decision_id=d.id
          and c.due_date between v_today and v_today + 7
          and c.status not in ('completed','stopped')
      )
    );

  select coalesce(jsonb_agg(jsonb_build_object('unit',unit,'open_decisions',open_dec)), '[]'::jsonb)
    into v_top_units
  from (
    select coalesce(m.org_unit_name_snapshot,'—') unit, count(*) open_dec
    from public.minutes_decisions d
    join public.minutes m on m.id=d.minute_id
    where d.parent_decision_id is null
      and public._user_can_view_minute(d.minute_id)
      and d.status in ('not_started','planned','in_progress','waiting_coordination','waiting_approval')
    group by m.org_unit_name_snapshot
    order by open_dec desc
    limit 5
  ) t;

  return jsonb_build_object(
    'total_minutes',v_total,'draft',v_draft,'pending_approval',v_pending,
    'changes_requested',v_changes,'approved',v_approved,'published',v_published,
    'open_decisions',v_open_dec,'overdue_decisions',v_overdue,
    'pending_my_approval',v_pending_my,'status_counts',v_status_counts,
    'decision_status_counts',v_dec_status_counts,'created_last_30',v_created_30,
    'decisions_near_deadline',v_near_deadline,'top_units',v_top_units
  );
end;
$function$;
