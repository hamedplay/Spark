-- Category 1: High-risk (IDOR) functions → SECURITY INVOKER
-- Verified safe via RLS policy analysis:
--   room_has_password       : conference_rooms SELECT true for anon+authenticated
--   validate_room_join      : same; lazy-cleanup DELETE silently no-ops for non-hosts (ban check still correct)
--   find_or_create_direct_conversation: chat_conv INSERT/UPDATE/SELECT cover participant_a/b = auth.uid()
--   get_unread_counts       : chat_messages SELECT policy scopes to participant
--   get_channel_unread_counts: channel_messages SELECT policy scopes to member
--   get_sms_dispatch_info   : profiles SELECT true; user_group_members accessible for self + admin
--   reset_meeting_inbox_for_creator: meeting_inbox DELETE/INSERT + meetings UPDATE all allow creator
--
-- Staying SECURITY DEFINER (intentional):
--   share_contact_to_user   : contacts_email INSERT WITH CHECK (auth.uid() = user_id) blocks cross-user insert
--   is_any_participant_calendar_subscribed: used in meetings SELECT RLS → recursion risk via calendar_subscriptions

CREATE OR REPLACE FUNCTION public.room_has_password(p_room_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
DECLARE
v_password text;
BEGIN
SELECT password INTO v_password
FROM conference_rooms
WHERE id = p_room_id;
RETURN v_password IS NOT NULL AND v_password <> '';
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_room_join(p_room_id uuid, p_password text DEFAULT NULL::text, p_user_id text DEFAULT NULL::text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
DECLARE
v_room       record;
v_count      integer;
v_ban        record;
v_uid        uuid;
BEGIN
SELECT id, password, is_locked, status, max_participants
INTO v_room
FROM conference_rooms
WHERE id = p_room_id;

IF NOT FOUND THEN
RETURN jsonb_build_object('allowed', false, 'reason', 'room_not_found');
END IF;

IF v_room.status = 'ended' THEN
RETURN jsonb_build_object('allowed', false, 'reason', 'room_ended');
END IF;

IF v_room.is_locked THEN
RETURN jsonb_build_object('allowed', false, 'reason', 'room_locked');
END IF;

-- Active ban check
IF p_user_id IS NOT NULL THEN
-- Try to cast to uuid; fall back to null if it's a non-uuid guest id
BEGIN
v_uid := p_user_id::uuid;
EXCEPTION WHEN invalid_text_representation THEN
v_uid := NULL;
END;

IF v_uid IS NOT NULL THEN
-- Lazy cleanup of expired bans first (may silently no-op for non-host callers — ban check below is still correct)
DELETE FROM banned_users
WHERE room_id = p_room_id
AND user_id = v_uid
AND expires_at IS NOT NULL
AND expires_at <= now();

-- Now check for an active ban
SELECT reason, expires_at INTO v_ban
FROM banned_users
WHERE room_id = p_room_id
AND user_id = v_uid
AND (expires_at IS NULL OR expires_at > now())
LIMIT 1;

IF FOUND THEN
RETURN jsonb_build_object(
'allowed',        false,
'reason',         'banned',
'ban_reason',     v_ban.reason,
'ban_expires_at', v_ban.expires_at
);
END IF;
END IF;
END IF;

IF v_room.password IS NOT NULL AND v_room.password <> '' THEN
IF p_password IS NULL OR p_password = '' OR v_room.password <> p_password THEN
RETURN jsonb_build_object('allowed', false, 'reason', 'wrong_password');
END IF;
END IF;

SELECT COUNT(*) INTO v_count
FROM conference_participants
WHERE room_id = p_room_id AND status = 'joined';

IF v_count >= v_room.max_participants THEN
RETURN jsonb_build_object('allowed', false, 'reason', 'room_full');
END IF;

RETURN jsonb_build_object('allowed', true, 'reason', 'ok');
END;
$function$;

CREATE OR REPLACE FUNCTION public.find_or_create_direct_conversation(user_a uuid, user_b uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
DECLARE
conv_id uuid;
p_a     uuid;
p_b     uuid;
BEGIN
IF auth.uid() IS NOT NULL
AND auth.uid() <> user_a
AND auth.uid() <> user_b
THEN
RAISE EXCEPTION 'Not authorized';
END IF;

-- Canonical ordering so (A,B) and (B,A) resolve to same row
IF user_a = user_b THEN
p_a := user_a; p_b := user_b;
ELSIF user_a < user_b THEN
p_a := user_a; p_b := user_b;
ELSE
p_a := user_b; p_b := user_a;
END IF;

-- Try to find existing (including previously deleted)
SELECT id INTO conv_id
FROM chat_conversations
WHERE ((participant_a = p_a AND participant_b = p_b)
OR (participant_a = p_b AND participant_b = p_a))
AND (type = 'direct' OR type IS NULL)
LIMIT 1;

IF conv_id IS NOT NULL THEN
-- Reset the deleted flag for the initiating user (user_a)
UPDATE chat_conversations
SET
deleted_for_a = CASE WHEN participant_a = user_a THEN false ELSE deleted_for_a END,
deleted_for_b = CASE WHEN participant_b = user_a THEN false ELSE deleted_for_b END
WHERE id = conv_id;
RETURN conv_id;
END IF;

-- Create new
INSERT INTO chat_conversations (participant_a, participant_b, type)
VALUES (p_a, p_b, 'direct')
ON CONFLICT DO NOTHING
RETURNING id INTO conv_id;

IF conv_id IS NULL THEN
SELECT id INTO conv_id
FROM chat_conversations
WHERE participant_a = p_a AND participant_b = p_b
AND (type = 'direct' OR type IS NULL)
LIMIT 1;
END IF;

RETURN conv_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_unread_counts(p_user_id uuid)
  RETURNS TABLE(conversation_id uuid, unread_count bigint)
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
BEGIN
IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
RAISE EXCEPTION 'Not authorized';
END IF;

RETURN QUERY
SELECT cm.conversation_id, COUNT(*)::bigint AS unread_count
FROM chat_messages cm
WHERE cm.sender_id <> p_user_id
AND NOT (cm.read_by @> ARRAY[p_user_id::text])
AND cm.deleted_for_all = false
AND cm.conversation_id IN (
SELECT id FROM chat_conversations
WHERE participant_a = p_user_id OR participant_b = p_user_id
)
GROUP BY cm.conversation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_channel_unread_counts(p_user_id uuid)
  RETURNS TABLE(channel_id uuid, unread_count bigint)
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
BEGIN
IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
RAISE EXCEPTION 'Not authorized';
END IF;

RETURN QUERY
SELECT cm.channel_id, COUNT(*)::bigint AS unread_count
FROM channel_messages cm
INNER JOIN channel_members mem
ON mem.channel_id = cm.channel_id AND mem.user_id = p_user_id
WHERE cm.sender_id != p_user_id
AND cm.deleted_for_all = false
AND NOT (COALESCE(cm.read_by, ARRAY[]::uuid[]) @> ARRAY[p_user_id])
GROUP BY cm.channel_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sms_dispatch_info(target_user_id uuid, p_category text)
  RETURNS TABLE(provider_id uuid, phone text)
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
BEGIN
-- service_role caller: auth.uid() IS NULL → bypass (Edge Function / cron)
IF auth.uid() IS NOT NULL
AND auth.uid() <> target_user_id
AND NOT public.is_current_user_admin()
THEN
RAISE EXCEPTION 'Not authorized';
END IF;

RETURN QUERY
SELECT sgr.provider_id, pr.phone
FROM user_group_members ugm
JOIN sms_group_rules sgr ON sgr.group_id = ugm.group_id
JOIN profiles        pr  ON pr.user_id   = target_user_id
WHERE ugm.user_id       = target_user_id
AND sgr.sms_category  = p_category
AND sgr.enabled       = true
LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_meeting_inbox_for_creator(p_meeting_id uuid, p_participant_ids text[])
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  v_creator_id uuid;
BEGIN
  SELECT user_id INTO v_creator_id FROM meetings WHERE id = p_meeting_id;
  IF v_creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the meeting creator can reset the inbox';
  END IF;

  -- Full reset: remove ALL existing entries (including accepted/delegated).
  -- Every participant must re-accept after an invitation resend.
  DELETE FROM meeting_inbox WHERE meeting_id = p_meeting_id;

  -- Insert fresh pending entries for all supplied participants.
  -- Creator is excluded by the caller (p_participant_ids already filtered).
  IF p_participant_ids IS NOT NULL AND array_length(p_participant_ids, 1) > 0 THEN
    INSERT INTO meeting_inbox (meeting_id, user_id, status)
    SELECT p_meeting_id, t.uid::uuid, 'pending'
    FROM unnest(p_participant_ids) AS t(uid);
  END IF;

  -- Clear the rejected flag so the meeting re-enters the requested workflow.
  UPDATE meetings
  SET status_type = 'requested'
  WHERE id = p_meeting_id;
END;
$function$;
