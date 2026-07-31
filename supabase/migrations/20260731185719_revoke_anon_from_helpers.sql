-- Revoke anon execute from internal helper functions
REVOKE EXECUTE ON FUNCTION public._can_track_decisions(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._can_view_minute(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._has_permission(uuid, text) FROM anon;
