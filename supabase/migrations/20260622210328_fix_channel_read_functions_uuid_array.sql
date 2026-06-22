
-- Fix: read_by column is uuid[] not text[]; all array operations must use uuid[] types

DROP FUNCTION IF EXISTS public.mark_channel_messages_read(uuid);

CREATE FUNCTION public.mark_channel_messages_read(p_channel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM channel_members
    WHERE channel_id = p_channel_id AND user_id = v_uid
  ) THEN RETURN; END IF;

  UPDATE channel_messages
  SET read_by = array_append(COALESCE(read_by, ARRAY[]::uuid[]), v_uid)
  WHERE channel_id = p_channel_id
    AND sender_id != v_uid
    AND deleted_for_all = false
    AND NOT (COALESCE(read_by, ARRAY[]::uuid[]) @> ARRAY[v_uid]);

  INSERT INTO channel_message_read_log (message_id, user_id, seen_at)
  SELECT id, v_uid, now()
  FROM channel_messages
  WHERE channel_id = p_channel_id
    AND sender_id != v_uid
    AND deleted_for_all = false
    AND COALESCE(read_by, ARRAY[]::uuid[]) @> ARRAY[v_uid]
  ON CONFLICT (message_id, user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_channel_messages_read(uuid) TO authenticated;


DROP FUNCTION IF EXISTS public.get_channel_unread_counts(uuid);

CREATE FUNCTION public.get_channel_unread_counts(p_user_id uuid)
RETURNS TABLE(channel_id uuid, unread_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
$$;

GRANT EXECUTE ON FUNCTION public.get_channel_unread_counts(uuid) TO authenticated;


-- Also fix the single-message variant which had the same text[] bug
DROP FUNCTION IF EXISTS public.mark_channel_message_read(uuid);
DROP FUNCTION IF EXISTS public.mark_channel_message_read(text);

CREATE FUNCTION public.mark_channel_message_read(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid;
  v_channel_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT channel_id INTO v_channel_id
  FROM public.channel_messages WHERE id = p_message_id;
  IF v_channel_id IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = v_channel_id AND user_id = v_uid
  ) THEN RETURN; END IF;

  UPDATE public.channel_messages
  SET read_by = array_append(COALESCE(read_by, ARRAY[]::uuid[]), v_uid)
  WHERE id = p_message_id
    AND NOT (COALESCE(read_by, ARRAY[]::uuid[]) @> ARRAY[v_uid]);

  INSERT INTO channel_message_read_log (message_id, user_id, seen_at)
  VALUES (p_message_id, v_uid, now())
  ON CONFLICT (message_id, user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_channel_message_read(uuid) TO authenticated;
