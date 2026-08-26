update public.user_groups g
set permissions = coalesce(g.permissions, '{}'::jsonb)
  || jsonb_build_object(
    'management_decisions.view', true,
    'management_decisions.manage', true,
    'management_tasks.view', true,
    'management_tasks.manage', true
  )
where coalesce((g.permissions->>'management_dashboard')::boolean, false) = true
  and (
    not (g.permissions ? 'management_decisions.view')
    or not (g.permissions ? 'management_decisions.manage')
    or not (g.permissions ? 'management_tasks.view')
    or not (g.permissions ? 'management_tasks.manage')
  );
