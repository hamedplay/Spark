-- Keep the "مصوبات من" new badge consistent with the cartable it describes.
-- Count distinct unread decision entities that are still owned by the current user,
-- visible to the user, and executable leaf decisions.

create or replace function private.get_my_minutes_hub_counts()
returns json
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_minutes_unread int; v_approvals_pending int; v_my_decisions_unread int; v_my_decisions_active int; v_followup_actionable int;
  v_minutes_total int; v_minutes_open int; v_minutes_closed int; v_approvals_total int; v_approvals_open int; v_approvals_closed int;
  v_my_decisions_total int; v_my_decisions_open int; v_my_decisions_closed int; v_followup_total int; v_followup_open int; v_followup_closed int;
  v_dash_minutes_total int; v_dash_minutes_open int; v_dash_minutes_closed int; v_dash_decisions_total int; v_dash_decisions_open int; v_dash_decisions_closed int;
  v_reports_total int; v_reports_open int; v_reports_closed int;
begin
  if v_user_id is null then
    return json_build_object('minutes_unread',0,'approvals_pending',0,'my_decisions_unread',0,'my_decisions_active',0,
      'followup_actionable',0,'minutes_total',0,'minutes_open',0,'minutes_closed',0,'approvals_total',0,'approvals_open',0,'approvals_closed',0,
      'my_decisions_total',0,'my_decisions_open',0,'my_decisions_closed',0,'followup_total',0,'followup_open',0,'followup_closed',0,
      'dashboard_minutes_total',0,'dashboard_minutes_open',0,'dashboard_minutes_closed',0,'dashboard_decisions_total',0,'dashboard_decisions_open',0,'dashboard_decisions_closed',0,
      'reports_total',0,'reports_open',0,'reports_closed',0);
  end if;

  select count(*) into v_minutes_unread
  from public.notifications
  where user_id=v_user_id
    and read=false
    and (template_category='minutes' or (template_category is null and entity_type='minute'));

  select count(*) into v_approvals_pending
  from public.minutes_approvals ma
  join public.minutes m on m.id=ma.minute_id
  where (ma.approver_user_id=v_user_id or ma.delegate_user_id=v_user_id)
    and ma.status='pending'
    and ma.revision_number=m.revision_number
    and m.status='pending_approval';

  v_approvals_total:=v_approvals_pending;
  v_approvals_open:=v_approvals_pending;
  v_approvals_closed:=0;

  select count(distinct n.entity_id)
  into v_my_decisions_unread
  from public.notifications n
  join public.minutes_decisions d on d.id = n.entity_id
  where n.user_id = v_user_id
    and n.read = false
    and (n.template_category='decision' or (n.template_category is null and n.entity_type='decision'))
    and d.primary_owner_user_id = v_user_id
    and public._user_can_view_minute(d.minute_id)
    and (
      d.parent_decision_id is not null
      or not exists (
        select 1
        from public.minutes_decisions c
        where c.parent_decision_id = d.id
      )
    );

  select coalesce(s.total_count,0),coalesce(s.active_count,0),coalesce(s.completed_count,0)+coalesce(s.stopped_count,0)
    into v_my_decisions_total,v_my_decisions_open,v_my_decisions_closed
  from private.get_my_minutes_decisions_summary() s;

  v_my_decisions_active:=v_my_decisions_open;

  select coalesce(s.total_count,0),coalesce(s.active_count,0),coalesce(s.completed_count,0)+coalesce(s.stopped_count,0),coalesce(s.requires_followup_count,0)
    into v_followup_total,v_followup_open,v_followup_closed,v_followup_actionable
  from private.get_trackable_minutes_decisions_summary() s;

  select count(*),count(*) filter(where m.status<>'published'),count(*) filter(where m.status='published')
    into v_minutes_total,v_minutes_open,v_minutes_closed
  from public.minutes m
  where public._user_can_view_minute(m.id);

  v_dash_minutes_total:=v_minutes_total;
  v_dash_minutes_open:=v_minutes_open;
  v_dash_minutes_closed:=v_minutes_closed;

  select count(*),
         count(*) filter(where d.status in ('not_started','planned','in_progress','waiting_coordination','waiting_approval')),
         count(*) filter(where d.status in ('completed','stopped'))
    into v_dash_decisions_total,v_dash_decisions_open,v_dash_decisions_closed
  from public.minutes_decisions d
  where d.parent_decision_id is null
    and public._user_can_view_minute(d.minute_id);

  v_reports_total:=v_minutes_total;
  v_reports_open:=v_minutes_open;
  v_reports_closed:=v_minutes_closed;

  return json_build_object(
    'minutes_unread',v_minutes_unread,
    'approvals_pending',v_approvals_pending,
    'my_decisions_unread',v_my_decisions_unread,
    'my_decisions_active',v_my_decisions_active,
    'followup_actionable',v_followup_actionable,
    'minutes_total',v_minutes_total,
    'minutes_open',v_minutes_open,
    'minutes_closed',v_minutes_closed,
    'approvals_total',v_approvals_total,
    'approvals_open',v_approvals_open,
    'approvals_closed',v_approvals_closed,
    'my_decisions_total',v_my_decisions_total,
    'my_decisions_open',v_my_decisions_open,
    'my_decisions_closed',v_my_decisions_closed,
    'followup_total',v_followup_total,
    'followup_open',v_followup_open,
    'followup_closed',v_followup_closed,
    'dashboard_minutes_total',v_dash_minutes_total,
    'dashboard_minutes_open',v_dash_minutes_open,
    'dashboard_minutes_closed',v_dash_minutes_closed,
    'dashboard_decisions_total',v_dash_decisions_total,
    'dashboard_decisions_open',v_dash_decisions_open,
    'dashboard_decisions_closed',v_dash_decisions_closed,
    'reports_total',v_reports_total,
    'reports_open',v_reports_open,
    'reports_closed',v_reports_closed
  );
end;
$function$;