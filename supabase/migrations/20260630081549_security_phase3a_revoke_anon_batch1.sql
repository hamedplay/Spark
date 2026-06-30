-- ═══════════════════════════════════════════════════════════════════
-- Phase 3-A: REVOKE EXECUTE from anon — 17 authenticated-only RPCs
-- ---------------------------------------------------------------
-- None of these are in the guest/anon join flow.
-- All use auth.uid() internally so anon access was functionally
-- harmless, but defense-in-depth demands explicit revocation.
-- No function body or logic is changed.
-- ═══════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.is_any_participant_calendar_subscribed(uuid[])   FROM anon;
REVOKE EXECUTE ON FUNCTION public.append_ice_candidate(uuid, text, jsonb)           FROM anon;
REVOKE EXECUTE ON FUNCTION public.clear_chat_for_user(uuid)                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_channel(text, text, text, boolean)         FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_channel_message(uuid)                      FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_chat_for_user(uuid)                        FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_chat_message_for_me(uuid)                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.flag_meeting_rejected(uuid)                        FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_channel_message_read(uuid)                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_channel_messages_read(uuid)                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_conversation_messages_read(uuid)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.remove_self_from_meeting(uuid)                    FROM anon;
REVOKE EXECUTE ON FUNCTION public.resend_meeting_invitations(uuid)                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_meeting_inbox_for_creator(uuid, text[])     FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_chat_manually_unread(uuid, boolean)            FROM anon;
REVOKE EXECUTE ON FUNCTION public.toggle_pin_chat(uuid)                              FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_unread_counts(uuid)                            FROM anon;
