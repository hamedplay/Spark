-- Bulk mark-all-unread channel messages as read for current user (matches mark_conversation_messages_read pattern)
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

  -- Verify membership
  IF NOT EXISTS (
    SELECT 1 FROM channel_members
    WHERE channel_id = p_channel_id AND user_id = v_uid
  ) THEN RETURN; END IF;

  -- Append uid to read_by for all unread, non-deleted messages not sent by self
  UPDATE channel_messages
  SET read_by = array_append(COALESCE(read_by, ARRAY[]::text[]), v_uid::text)
  WHERE channel_id = p_channel_id
    AND sender_id != v_uid
    AND deleted_for_all = false
    AND NOT (COALESCE(read_by, ARRAY[]::text[]) @> ARRAY[v_uid::text]);

  -- Write per-message seen timestamps to read log
  INSERT INTO channel_message_read_log (message_id, user_id, seen_at)
  SELECT id, v_uid, now()
  FROM channel_messages
  WHERE channel_id = p_channel_id
    AND sender_id != v_uid
    AND deleted_for_all = false
    AND COALESCE(read_by, ARRAY[]::text[]) @> ARRAY[v_uid::text]
  ON CONFLICT (message_id, user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_channel_messages_read(uuid) TO authenticated;
