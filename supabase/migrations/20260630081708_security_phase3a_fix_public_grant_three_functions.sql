-- ═══════════════════════════════════════════════════════════════════
-- Phase 3-A fix: Three functions had GRANT TO PUBLIC.
-- REVOKE FROM anon alone does not override a PUBLIC grant.
-- Pattern: REVOKE FROM PUBLIC → GRANT back to authenticated + service_role.
-- ═══════════════════════════════════════════════════════════════════

-- get_unread_counts
REVOKE EXECUTE ON FUNCTION public.get_unread_counts(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_unread_counts(uuid) TO authenticated, service_role;

-- mark_channel_message_read
REVOKE EXECUTE ON FUNCTION public.mark_channel_message_read(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.mark_channel_message_read(uuid) TO authenticated, service_role;

-- mark_channel_messages_read
REVOKE EXECUTE ON FUNCTION public.mark_channel_messages_read(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.mark_channel_messages_read(uuid) TO authenticated, service_role;
