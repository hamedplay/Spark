-- Track per-message, per-user seen timestamps for channel messages
CREATE TABLE IF NOT EXISTS channel_message_read_log (
  message_id uuid NOT NULL,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

ALTER TABLE channel_message_read_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_read_log_select" ON channel_message_read_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "channel_read_log_insert" ON channel_message_read_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ch_read_log_message ON channel_message_read_log (message_id);

-- Update mark_channel_message_read to also write a timestamped log entry
CREATE OR REPLACE FUNCTION mark_channel_message_read(p_message_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_channel_id uuid;
BEGIN
  SELECT channel_id INTO v_channel_id
  FROM public.channel_messages WHERE id = p_message_id;

  IF v_channel_id IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = v_channel_id AND user_id = v_uid
  ) THEN RETURN; END IF;

  -- Update read_by array on the message
  UPDATE public.channel_messages
  SET read_by = array_append(COALESCE(read_by, '{}'), v_uid::text)
  WHERE id = p_message_id
    AND NOT (v_uid::text = ANY(COALESCE(read_by, '{}')));

  -- Log seen timestamp (ignore if already exists)
  INSERT INTO channel_message_read_log (message_id, user_id, seen_at)
  VALUES (p_message_id, v_uid, now())
  ON CONFLICT (message_id, user_id) DO NOTHING;
END;
$$;
