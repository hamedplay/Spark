-- Category C: clear_chat_for_user → SECURITY INVOKER
--
-- Safe because chat_msg_update USING/WITH CHECK is:
--   EXISTS(chat_conversations WHERE participant_a = auth.uid() OR participant_b = auth.uid())
-- This covers BOTH participants for ALL messages in the conversation,
-- so "SET deleted_for_receiver = true WHERE sender_id != auth.uid()" works with INVOKER.
-- The participant check is conversation-based, not sender-based.
--
-- Remaining SECURITY DEFINER (cannot be converted):
--   flag_meeting_rejected    : meetings WITH CHECK = auth.uid()=user_id blocks non-creator participants
--   mark_channel_message_read: cm_msg_update requires sender_id=auth.uid() OR admin; received msgs blocked
--   mark_channel_messages_read: same constraint
--   remove_self_from_meeting : meetings WITH CHECK = auth.uid()=user_id blocks participants

CREATE OR REPLACE FUNCTION public.clear_chat_for_user(p_conversation_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
BEGIN
UPDATE public.chat_messages
SET deleted_for_sender = true
WHERE conversation_id = p_conversation_id AND sender_id = auth.uid();

UPDATE public.chat_messages
SET deleted_for_receiver = true
WHERE conversation_id = p_conversation_id AND sender_id != auth.uid();
END;
$function$;
