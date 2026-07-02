-- Fix: Convert chat delete RPCs to SECURITY DEFINER
-- Root cause: SECURITY INVOKER functions cannot reliably UPDATE chat_messages rows
-- where sender_id != auth.uid() due to RLS interaction between chat_msg_select USING
-- and chat_msg_update WITH CHECK subquery context.
-- Pattern: same fix applied to toggle_pin_chat in 20260702092826.
-- Authorization: each function retains its own participant validation logic.

CREATE OR REPLACE FUNCTION public.clear_chat_for_user(p_conversation_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Verify caller is a participant before making any changes
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_conversations
    WHERE id = p_conversation_id
      AND (participant_a = auth.uid() OR participant_b = auth.uid() OR created_by = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Mark own sent messages as deleted for sender
  UPDATE public.chat_messages
  SET deleted_for_sender = true
  WHERE conversation_id = p_conversation_id
    AND sender_id = auth.uid();

  -- Mark received messages as deleted for receiver
  UPDATE public.chat_messages
  SET deleted_for_receiver = true
  WHERE conversation_id = p_conversation_id
    AND sender_id != auth.uid();
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_chat_for_user(p_conversation_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.clear_chat_for_user(p_conversation_id);

  UPDATE public.chat_conversations
  SET
    deleted_for_a = CASE WHEN participant_a = auth.uid() THEN true ELSE deleted_for_a END,
    deleted_for_b = CASE WHEN participant_b = auth.uid() THEN true ELSE deleted_for_b END
  WHERE id = p_conversation_id
    AND (participant_a = auth.uid() OR participant_b = auth.uid());
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_chat_message_for_me(p_message_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sender_id       uuid;
  v_conversation_id uuid;
BEGIN
  SELECT sender_id, conversation_id
  INTO v_sender_id, v_conversation_id
  FROM public.chat_messages
  WHERE id = p_message_id;

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  -- Verify caller is a participant in this conversation
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_conversations
    WHERE id = v_conversation_id
      AND (participant_a = auth.uid() OR participant_b = auth.uid() OR created_by = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_sender_id = auth.uid() THEN
    UPDATE public.chat_messages SET deleted_for_sender   = true WHERE id = p_message_id;
  ELSE
    UPDATE public.chat_messages SET deleted_for_receiver = true WHERE id = p_message_id;
  END IF;
END;
$function$;
