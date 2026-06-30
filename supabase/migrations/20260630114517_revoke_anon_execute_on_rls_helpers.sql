-- Revoke direct RPC access for anon on RLS helper functions.
-- All policies using these helpers are scoped to {authenticated} only.
REVOKE EXECUTE ON FUNCTION public.is_chat_participant(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_current_user_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_subscribed_to_calendar(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.chat_message_conv_id(uuid) FROM anon;