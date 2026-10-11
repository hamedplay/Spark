alter function public.has_management_dashboard_access_v1() security definer;

revoke all on function public.has_management_dashboard_access_v1() from public, anon;
grant execute on function public.has_management_dashboard_access_v1() to authenticated, service_role;
