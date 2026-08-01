-- Grant EXECUTE on _can_track_decisions(uuid) to authenticated so RLS
-- policies on minutes_decisions and minutes_decision_updates can evaluate
-- for signed-in users. Previously only service_role had EXECUTE, causing
-- "permission denied for function _can_track_decisions" for authenticated.

REVOKE EXECUTE
ON FUNCTION public._can_track_decisions(uuid)
FROM PUBLIC;

REVOKE EXECUTE
ON FUNCTION public._can_track_decisions(uuid)
FROM anon;

GRANT EXECUTE
ON FUNCTION public._can_track_decisions(uuid)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public._can_track_decisions(uuid)
TO service_role;
