-- ═══════════════════════════════════════════════════════════════════
-- REVOKE EXECUTE on reset_conv_deleted_flags from anon + authenticated
-- ---------------------------------------------------------------
-- This is a TRIGGER function (RETURNS trigger). PostgreSQL blocks
-- direct invocation of trigger functions ("can only be called as
-- triggers"), so the existing grants were always inert. Revoking
-- them removes the bad-practice surface without any functional
-- impact: the trigger still fires automatically on INSERT into
-- chat_messages, driven by the trigger definition, not EXECUTE
-- privilege.
--
-- ROLLBACK:
--   GRANT EXECUTE ON FUNCTION public.reset_conv_deleted_flags()
--     TO anon, authenticated;
-- ═══════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.reset_conv_deleted_flags() FROM anon, authenticated;
