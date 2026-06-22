-- Per-message, per-user read timestamps for chat (mirrors channel_message_read_log)
CREATE TABLE IF NOT EXISTS chat_message_read_log (
  message_id uuid NOT NULL,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

ALTER TABLE chat_message_read_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_read_log_select" ON chat_message_read_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "chat_read_log_insert" ON chat_message_read_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_chat_read_log_message ON chat_message_read_log (message_id);

-- Update mark_conversation_messages_read to also write per-message timestamps
CREATE OR REPLACE FUNCTION mark_conversation_messages_read(p_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
$$;
