-- Restore authenticated client execution for management dashboard RPCs that
-- perform their own session and permission checks internally.

GRANT EXECUTE ON FUNCTION public.get_management_minutes_dashboard_stats_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_management_minutes_v1(text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_management_decisions_v3(text, text, uuid, uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_management_capabilities_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_management_scope_people_v1() TO authenticated;
