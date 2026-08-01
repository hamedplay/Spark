/*
# Fix EXECUTE grants on _user_can_view_minute(uuid)

The function is SECURITY DEFINER with empty search_path, uses auth.uid(),
schema-qualified table references, and returns boolean — definition is safe.

Problem: authenticated role lacks EXECUTE privilege, so RLS policies on
minutes, minutes_attachments, minutes_audit_log, and storage.objects
(minutes_attachments_read) call this function and get:
  "permission denied for function _user_can_view_minute"

This migration only adjusts grants on this one function signature.
No function rewrite, no policy change, no data change.
*/

REVOKE EXECUTE
ON FUNCTION public._user_can_view_minute(uuid)
FROM PUBLIC;

REVOKE EXECUTE
ON FUNCTION public._user_can_view_minute(uuid)
FROM anon;

GRANT EXECUTE
ON FUNCTION public._user_can_view_minute(uuid)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public._user_can_view_minute(uuid)
TO service_role;
