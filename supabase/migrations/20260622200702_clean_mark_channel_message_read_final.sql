-- Drop all variants to ensure a clean slate
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

  -- channel_messages.id is uuid, channel_messages.channel_id is uuid
  SELECT channel_id INTO v_channel_id
  FROM public.channel_messages
  WHERE id = p_message_id;

  IF v_channel_id IS NULL THEN RETURN; END IF;

  -- channel_members.channel_id and user_id are both uuid
  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = v_channel_id
      AND user_id = v_uid
  ) THEN RETURN; END IF;

  -- read_by is text[], so cast v_uid to text only when touching the array
  UPDATE public.channel_messages
  SET read_by = array_append(COALESCE(read_by, ARRAY[]::text[]), v_uid::text)
  WHERE id = p_message_id
    AND NOT (COALESCE(read_by, ARRAY[]::text[]) @> ARRAY[v_uid::text]);

  -- channel_message_read_log.user_id is uuid
  INSERT INTO channel_message_read_log (message_id, user_id, seen_at)
  VALUES (p_message_id, v_uid, now())
  ON CONFLICT (message_id, user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_channel_message_read(uuid) TO authenticated;
