-- Keep the dedicated management dashboard gate aligned with the
-- organization permission model. Admin status must not bypass this one
-- permission; the navigation and page guard already treat it as dedicated.
create or replace function public.has_management_dashboard_access_v1()
returns boolean
language sql
stable
set search_path = ''
as $function$
  select case
    when auth.uid() is null then false
    when not private.is_current_session_fully_authorized() then false
    else public._has_permission(auth.uid(), 'management_dashboard')
  end
$function$;

revoke all on function public.has_management_dashboard_access_v1() from public;
revoke all on function public.has_management_dashboard_access_v1() from anon;
grant execute on function public.has_management_dashboard_access_v1() to authenticated;
grant execute on function public.has_management_dashboard_access_v1() to service_role;
