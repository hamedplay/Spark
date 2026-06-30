-- ═══════════════════════════════════════════════════════════════════
-- Step 5: remove_meeting_participant — REVOKE from authenticated
-- ---------------------------------------------------------------
-- Dead-code check (step 0.3): confirmed empty — no other DB function
-- calls remove_meeting_participant; no frontend call site exists.
-- Per policy: dead function with no guard → REVOKE from all clients.
-- service_role retains access by default if ever needed programmatically.
-- ═══════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.remove_meeting_participant(uuid, uuid) FROM authenticated;
