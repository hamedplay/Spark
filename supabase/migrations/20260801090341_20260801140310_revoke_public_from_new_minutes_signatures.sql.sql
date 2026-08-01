/*
# Revoke PUBLIC/anon from new create_minutes_draft and update_minutes_draft signatures

The new signatures with p_decisions got default PUBLIC grants from CREATE OR REPLACE.
This revokes PUBLIC and anon, keeping only authenticated + service_role.

No data changes.
*/

REVOKE EXECUTE ON FUNCTION public.create_minutes_draft(jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_minutes_draft(jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_minutes_draft(jsonb, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamp with time zone, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamp with time zone, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamp with time zone, jsonb, jsonb) TO authenticated;
