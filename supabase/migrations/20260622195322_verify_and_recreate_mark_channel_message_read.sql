
-- Drop and recreate to ensure it exists with correct signature
DROP FUNCTION IF EXISTS mark_channel_message_read(uuid);

CREATE FUNCTION mark_channel_message_read(p_message_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_channel_id uuid;
BEGIN
  SELECT channel_id INTO v_channel_id
  FROM public.channel_messages WHERE id = p_message_id;

  IF v_channel_id IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = v_channel_id AND user_id = v_uid
  ) THEN RETURN; END IF;

  UPDATE public.channel_messages
  SET read_by = array_append(COALESCE(read_by, '{}'), v_uid::text)
  WHERE id = p_message_id
    AND NOT (v_uid::text = ANY(COALESCE(read_by, '{}')));

  INSERT INTO channel_message_read_log (message_id, user_id, seen_at)
  VALUES (p_message_id, v_uid, now())
  ON CONFLICT (message_id, user_id) DO NOTHING;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION mark_channel_message_read(uuid) TO authenticated;
