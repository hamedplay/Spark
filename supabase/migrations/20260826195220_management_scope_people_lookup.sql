create or replace function public.get_management_scope_people_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not private.is_current_session_fully_authorized() then
    raise exception 'AUTH_ACCESS_RESTRICTED' using errcode = '42501';
  end if;
  if not private.current_user_has_permission_v1('management_dashboard') then
    raise exception 'MANAGEMENT_DASHBOARD_FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.user_id,
    'full_name', coalesce(nullif(btrim(p.full_name), ''), p.username, 'بدون نام'),
    'unit_id', p.primary_unit_id,
    'unit_name', coalesce(ou.name, 'بدون واحد'),
    'position_id', p.primary_position_id,
    'position_title', op.title
  ) order by coalesce(ou.sort_order, 2147483647), coalesce(p.full_name, p.username, '')), '[]'::jsonb)
  into v_result
  from public.profiles p
  left join public.org_units ou on ou.id = p.primary_unit_id
  left join public.org_positions op on op.id = p.primary_position_id
  where p.is_active is distinct from false
    and p.user_id in (
      select scoped_user_id from private.get_management_scope_users_v1(v_uid)
    );

  return v_result;
end;
$fn$;

revoke all on function public.get_management_scope_people_v1() from public;
grant execute on function public.get_management_scope_people_v1() to authenticated;
