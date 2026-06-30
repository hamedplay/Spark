-- Phase 1: Fix search_path for 20 SECURITY DEFINER functions
-- Change: search_path=public  →  search_path=public, pg_temp
-- Prevents pg_temp shadowing attacks. No function body is modified.
-- Rollback: replace SET search_path = public, pg_temp with SET search_path = public

ALTER FUNCTION public.ch_update_channel_last_message()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.ch_update_member_count()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.create_default_calendars_for_user()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.find_or_create_direct_conversation(uuid, uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.flag_meeting_rejected(uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_channel_unread_counts(uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_sms_dispatch_info(uuid, text)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.handle_new_user_presence()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.insert_channel_system_message(uuid, text)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.mark_channel_message_read(uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.mark_channel_messages_read(uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.remove_meeting_participant(uuid, uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.resend_meeting_invitations(uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.reset_meeting_inbox_for_creator(uuid, text[])
  SET search_path = public, pg_temp;

ALTER FUNCTION public.room_has_password(uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.share_contact_to_user(text, text, text, text, uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.trigger_daily_meetings_send()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.update_channel_last_message()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.update_channel_member_count()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.validate_room_join(uuid, text, text)
  SET search_path = public, pg_temp;