-- Completed decisions must not retain blockers that are still considered open.
-- Keep the existing obstacle/counting RPCs unchanged and enforce the invariant
-- at the lifecycle boundary instead.

create or replace function private.close_open_obstacles_on_decision_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.minutes_decision_updates
  set
    resolved_at = coalesce(resolved_at, coalesce(new.completed_at, now())),
    resolved_by_user_id = coalesce(resolved_by_user_id, auth.uid())
  where decision_id = new.id
    and event_type = 'obstacle'
    and is_blocking = true
    and resolved_at is null;

  return new;
end;
$$;

revoke all on function private.close_open_obstacles_on_decision_completion() from public;

-- This trigger only runs on the transition into completed. Reopening a decision
-- does not reopen historical obstacles.
drop trigger if exists trg_close_open_obstacles_on_decision_completion
  on public.minutes_decisions;

create trigger trg_close_open_obstacles_on_decision_completion
after update of status on public.minutes_decisions
for each row
when (new.status = 'completed' and old.status is distinct from new.status)
execute function private.close_open_obstacles_on_decision_completion();

-- Repair legacy rows created before the invariant existed. A completed decision
-- cannot still be blocked, so its unresolved obstacle is closed at completion.
update public.minutes_decision_updates u
set resolved_at = coalesce(d.completed_at, d.updated_at, now())
from public.minutes_decisions d
where d.id = u.decision_id
  and d.status = 'completed'
  and u.event_type = 'obstacle'
  and u.is_blocking = true
  and u.resolved_at is null;
