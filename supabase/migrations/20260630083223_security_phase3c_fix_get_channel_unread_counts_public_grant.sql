-- get_channel_unread_counts has GRANT TO PUBLIC (same pattern as
-- mark_channel_message_read in phase3a_fix). Must revoke from PUBLIC
-- then re-grant to authenticated and service_role explicitly.
REVOKE EXECUTE ON FUNCTION public.get_channel_unread_counts(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_channel_unread_counts(uuid) TO authenticated, service_role;
