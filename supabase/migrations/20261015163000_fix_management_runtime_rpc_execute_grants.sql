-- Restore authenticated execution for management/security RPCs that enforce
-- their own authorization internally and are called directly by the frontend.

GRANT EXECUTE ON FUNCTION public.get_management_tasks_v2(text, text, uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_locked_accounts() TO authenticated;
