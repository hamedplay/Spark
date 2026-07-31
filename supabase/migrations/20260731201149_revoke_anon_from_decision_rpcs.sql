-- Revoke anon execute from all decision-related application RPCs
REVOKE EXECUTE ON FUNCTION public.get_minutes_decisions_for_view(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_minutes_decisions(text, text, text, boolean, text, date, date, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_minutes_decisions_summary() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_trackable_minutes_decisions(text, uuid, uuid, uuid, text, text, boolean, boolean, text, date, date, date, date, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_trackable_minutes_decisions_summary() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_any_trackable_minutes_decision() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_my_minutes_decision(uuid, timestamptz, integer, text, text, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, timestamptz, text, text, text, text, jsonb, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_my_minutes_decision_obstacle(uuid, timestamptz, uuid, text) FROM anon;
