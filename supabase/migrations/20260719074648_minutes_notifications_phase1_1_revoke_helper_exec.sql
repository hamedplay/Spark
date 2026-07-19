/*
# Minutes Notifications — Phase 1.1: harden helper execution privilege

The helper `public._create_minutes_notification` is SECURITY DEFINER and must
NOT be directly callable by anon or authenticated roles. Only the owner-role
Minutes RPCs should call it. The previous REVOKE FROM PUBLIC did not fully
restrict it because Supabase's `authenticated` and `anon` roles still held
EXECUTE. This migration explicitly revokes EXECUTE from anon and authenticated.
*/

REVOKE EXECUTE ON FUNCTION public._create_minutes_notification(
  uuid, text, text, text, text, uuid, uuid, integer, uuid, jsonb, text
) FROM anon, authenticated;
