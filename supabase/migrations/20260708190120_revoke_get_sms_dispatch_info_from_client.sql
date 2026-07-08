-- Revoke direct client access to get_sms_dispatch_info.
-- This RPC was previously callable by authenticated browser sessions and exposed
-- target user phone numbers + provider IDs to the frontend.
-- SMS resolution is now performed server-side inside the send-sms Edge Function
-- using the admin (service role) client, so client access is no longer needed.
REVOKE EXECUTE
  ON FUNCTION public.get_sms_dispatch_info(uuid, text)
  FROM anon, authenticated;
