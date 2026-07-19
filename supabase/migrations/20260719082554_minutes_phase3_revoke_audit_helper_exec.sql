/*
# Minutes Phase 3 — tighten audit helper execution

The append-only audit helper `_write_minutes_audit` must NOT be directly
callable by anon/authenticated — only the SECURITY DEFINER trigger functions
call it (they run with the table owner's privileges, bypassing the caller's
EXECUTE grant). This migration revokes direct EXECUTE from anon and
authenticated.

Note: `_user_can_view_minute` and `_minutes_attachment_target_ok` are
intentionally left executable because RLS policies and CHECK constraints
invoke them with the caller's privileges; revoking would break RLS.
*/

REVOKE EXECUTE ON FUNCTION public._write_minutes_audit(uuid,text,text,uuid,integer,jsonb,jsonb,jsonb) FROM anon, authenticated;
