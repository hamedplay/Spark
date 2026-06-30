-- ═══════════════════════════════════════════════════════════════
-- Phase 2: Revoke EXECUTE from anon on 4 SECURITY DEFINER RPCs
-- ---------------------------------------------------------------
-- authenticated is intentionally preserved on all four:
--   • get_sms_dispatch_info      → called from frontend with user JWT
--   • insert_channel_system_message → called from frontend (channel admin)
--   • remove_meeting_participant → dead code but keep authenticated for future
--   • share_contact_to_user      → called from frontend (logged-in user)
--
-- validate_room_join is NOT touched (anon required for guest join flow).
-- No function body or logic is changed.
-- ═══════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.get_sms_dispatch_info(target_user_id uuid, p_category text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.insert_channel_system_message(p_channel_id uuid, p_body text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.remove_meeting_participant(p_meeting_id uuid, p_user_id uuid)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.share_contact_to_user(p_name text, p_email text, p_phone text, p_company text, p_target_user_id uuid)
  FROM anon;
