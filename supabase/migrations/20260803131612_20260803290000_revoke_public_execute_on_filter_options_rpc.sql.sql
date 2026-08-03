/*
# Revoke EXECUTE from PUBLIC and anon on get_minutes_decision_filter_options.
# Only authenticated, service_role, and postgres should have access.
*/

REVOKE EXECUTE ON FUNCTION public.get_minutes_decision_filter_options FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_minutes_decision_filter_options FROM anon;

GRANT EXECUTE ON FUNCTION public.get_minutes_decision_filter_options TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_minutes_decision_filter_options TO service_role;
GRANT EXECUTE ON FUNCTION public.get_minutes_decision_filter_options TO postgres;
