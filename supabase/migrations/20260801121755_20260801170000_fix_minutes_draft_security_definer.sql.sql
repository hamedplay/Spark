-- Fix: create_minutes_draft and update_minutes_draft call the internal
-- helper _sync_minutes_decisions(uuid,jsonb) which is SECURITY DEFINER
-- and only executable by service_role. Because the parent functions run
-- as SECURITY INVOKER, the internal call executes under the authenticated
-- role and fails with "permission denied for function _sync_minutes_decisions".
--
-- Solution: convert both public RPCs to SECURITY DEFINER so the internal
-- call runs under the postgres owner. All existing authorization checks
-- (auth.uid(), permission checks, status checks, optimistic locking) are
-- preserved — only the execution context changes.

ALTER FUNCTION public.create_minutes_draft(jsonb, jsonb)
  SECURITY DEFINER;

ALTER FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb, jsonb)
  SECURITY DEFINER;

-- Re-apply grants precisely as specified.

REVOKE EXECUTE ON FUNCTION public.create_minutes_draft(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_minutes_draft(jsonb, jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb, jsonb) TO authenticated, service_role;

-- Ensure the helper stays internal-only.
REVOKE EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb) TO service_role;

-- Also re-grant _can_track_decisions to authenticated (from prior migration,
-- re-applied here to be safe alongside the SECURITY DEFINER change).
REVOKE EXECUTE ON FUNCTION public._can_track_decisions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._can_track_decisions(uuid) TO authenticated, service_role;
