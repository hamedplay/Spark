-- Category 2: Medium-risk (ownership/membership) functions → SECURITY INVOKER
-- Verified safe via RLS policy analysis:
--   append_ice_candidate        : call_sessions UPDATE policy covers caller_id/callee_id = auth.uid()
--   create_channel              : channels INSERT (created_by=auth.uid()), channel_members INSERT (user_id=auth.uid())
--   delete_channel_message      : cm_msg_update allows sender or admin; NOT FOUND guard handles non-members
--   delete_chat_for_user        : calls clear_chat_for_user (stays DEFINER); chat_conv_update covers participant
--   delete_chat_message_for_me  : chat_msg_update covers conversation participants
--   mark_conversation_messages_read: chat_msg_update covers participants; chat_read_log_insert covers own user_id
--
-- Staying SECURITY DEFINER (intentional — cannot work with INVOKER):
--   clear_chat_for_user       : updates chat_messages WHERE sender_id != auth.uid() (receiver side) — no UPDATE policy for that
--   flag_meeting_rejected     : meetings UPDATE WITH CHECK = auth.uid()=user_id blocks non-creator participants
--   remove_self_from_meeting  : same WITH CHECK issue for participants
--   resend_meeting_invitations: updates meeting_inbox for OTHER users (policy: auth.uid()=user_id only)
--   mark_channel_message_read : updates channel_messages.read_by for received msgs (cm_msg_update: sender=auth.uid() or admin)
--   mark_channel_messages_read: same constraint
--   insert_channel_system_message: NULL sender_id with private.is_channel_member_of in WITH CHECK; also called by service_role

CREATE OR REPLACE FUNCTION public.append_ice_candidate(p_session_id uuid, p_field text, p_candidate jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
DECLARE
v_uid uuid := auth.uid();
BEGIN
IF p_field NOT IN ('caller_candidates', 'callee_candidates') THEN
RAISE EXCEPTION 'Invalid field name';
END IF;

IF p_field = 'caller_candidates' THEN
UPDATE public.call_sessions
SET caller_candidates = COALESCE(caller_candidates, '[]'::jsonb) || jsonb_build_array(p_candidate)
WHERE id = p_session_id AND caller_id = v_uid;
ELSE
UPDATE public.call_sessions
SET callee_candidates = COALESCE(callee_candidates, '[]'::jsonb) || jsonb_build_array(p_candidate)
WHERE id = p_session_id AND callee_id = v_uid;
END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_channel(p_name text, p_description text, p_type text, p_is_private boolean)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
DECLARE
v_channel_id uuid;
v_user_id    uuid;
BEGIN
v_user_id := auth.uid();
IF v_user_id IS NULL THEN
RAISE EXCEPTION 'Not authenticated';
END IF;

INSERT INTO public.channels (name, description, type, is_private, created_by)
VALUES (p_name, p_description, p_type, p_is_private, v_user_id)
RETURNING id INTO v_channel_id;

INSERT INTO public.channel_members (channel_id, user_id, role)
VALUES (v_channel_id, v_user_id, 'admin');

RETURN v_channel_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_channel_message(p_message_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
DECLARE
v_channel_id uuid;
v_sender_id  uuid;
v_is_admin   boolean;
BEGIN
SELECT channel_id, sender_id INTO v_channel_id, v_sender_id
FROM public.channel_messages WHERE id = p_message_id;

IF NOT FOUND THEN RETURN; END IF;

SELECT (
EXISTS(SELECT 1 FROM public.channel_members
WHERE channel_id = v_channel_id AND user_id = auth.uid() AND role = 'admin')
OR EXISTS(SELECT 1 FROM public.channels
WHERE id = v_channel_id AND created_by = auth.uid())
) INTO v_is_admin;

IF v_sender_id = auth.uid() OR v_is_admin THEN
UPDATE public.channel_messages
SET
deleted_for_all = true,
body            = '⛔ این پیام حذف شده است',
file_url        = null,
file_name       = null,
file_type       = null,
file_size       = null,
voice_url       = null,
voice_duration  = null
WHERE id = p_message_id;
END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_chat_for_user(p_conversation_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
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
  SECURITY INVOKER
  SET search_path = public, pg_temp
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

CREATE OR REPLACE FUNCTION public.mark_conversation_messages_read(p_conversation_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
DECLARE
v_uid uuid := auth.uid();
v_msg_id uuid;
BEGIN
IF NOT EXISTS (
SELECT 1 FROM public.chat_conversations
WHERE id = p_conversation_id
AND (participant_a = v_uid OR participant_b = v_uid OR created_by = v_uid)
) THEN RETURN; END IF;

-- Update read_by on messages and log timestamps in one pass
FOR v_msg_id IN
SELECT id FROM public.chat_messages
WHERE conversation_id = p_conversation_id
AND sender_id <> v_uid
AND NOT (v_uid::text = ANY(read_by))
AND deleted_for_all = false
LOOP
UPDATE public.chat_messages
SET read_by = array_append(read_by, v_uid::text)
WHERE id = v_msg_id;

INSERT INTO public.chat_message_read_log (message_id, user_id, seen_at)
VALUES (v_msg_id, v_uid, now())
ON CONFLICT (message_id, user_id) DO NOTHING;
END LOOP;
END;
$function$;
