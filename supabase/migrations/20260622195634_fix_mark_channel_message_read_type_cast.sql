DROP FUNCTION IF EXISTS mark_channel_message_read(uuid);

CREATE FUNCTION mark_channel_message_read(p_message_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid        text := auth.uid()::text;
  v_channel_id text;
BEGIN
  SELECT channel_id::text INTO v_channel_id
  FROM public.channel_messages WHERE id = p_message_id;

  IF v_channel_id IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id::text = v_channel_id AND user_id::text = v_uid
  ) THEN RETURN; END IF;

  UPDATE public.channel_messages
  SET read_by = array_append(COALESCE(read_by, '{}'), v_uid)
  WHERE id = p_message_id
    AND NOT (v_uid = ANY(COALESCE(read_by, '{}')));

  INSERT INTO channel_message_read_log (message_id, user_id, seen_at)
  VALUES (p_message_id, auth.uid(), now())
  ON CONFLICT (message_id, user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_channel_message_read(uuid) TO authenticated;
