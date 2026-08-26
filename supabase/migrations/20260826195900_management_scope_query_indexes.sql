create index if not exists idx_org_units_parent_id
  on public.org_units(parent_id);

create index if not exists idx_profiles_primary_unit_active
  on public.profiles(primary_unit_id, user_id)
  where is_active is distinct from false;

create index if not exists idx_minutes_decisions_responsible_unit_status_due
  on public.minutes_decisions(responsible_unit_id, status, due_date);

create index if not exists idx_tasks_current_assignee_active
  on public.tasks(current_assignee_id, status)
  where coalesce(archived, false) = false;

create index if not exists idx_tasks_owner_active
  on public.tasks(user_id)
  where coalesce(archived, false) = false;

create index if not exists idx_tasks_created_by_active
  on public.tasks(created_by_id)
  where coalesce(archived, false) = false;
