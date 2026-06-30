-- ═══════════════════════════════════════════════════════════════════
-- Step 3/2 fix: REVOKE anon from two functions missed in batch-1
-- ---------------------------------------------------------------
-- find_or_create_direct_conversation and get_channel_unread_counts
-- were not included in security_phase3a_revoke_anon_batch1.
-- Their guards use `IF auth.uid() IS NOT NULL`, so an anon caller
-- (auth.uid() = NULL) would bypass the guard entirely.
-- Revoking anon closes that gap without affecting service_role
-- (which has implicit execute regardless of REVOKE TO anon).
-- ═══════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.find_or_create_direct_conversation(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_channel_unread_counts(uuid) FROM anon;
