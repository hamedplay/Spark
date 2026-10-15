-- Restore authenticated client execution for RPCs that enforce their own
-- authorization internally and are called directly by the Spark frontend.

GRANT EXECUTE ON FUNCTION public.get_my_meeting_delegations_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_management_dashboard_access_v1() TO authenticated;
