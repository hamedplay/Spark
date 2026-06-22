-- Bulk unread counts for all conversations of a user in a single query.
-- Replaces the N+1 pattern in ChatPage.tsx (one query per conversation).
CREATE OR REPLACE FUNCTION get_unread_counts(p_user_id uuid)
RETURNS TABLE(conversation_id uuid, unread_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    cm.conversation_id,
    COUNT(*) AS unread_count
  FROM chat_messages cm
  WHERE cm.sender_id <> p_user_id
    AND NOT (cm.read_by @> ARRAY[p_user_id::text])
    AND cm.deleted_for_all = false
    AND cm.conversation_id IN (
      SELECT id FROM chat_conversations
      WHERE participant_a = p_user_id OR participant_b = p_user_id
    )
  GROUP BY cm.conversation_id;
$$;

-- Index for the unread count query: filter by sender_id, then read_by check
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread
  ON chat_messages (conversation_id, sender_id)
  WHERE deleted_for_all = false;

-- Index for tag assignments lookup by user + message
CREATE INDEX IF NOT EXISTS idx_chat_tag_assignments_user_msg
  ON chat_message_tag_assignments (user_id, message_id);

-- Index for chat_message_stars by message_id (joins in fetchMessages)
CREATE INDEX IF NOT EXISTS idx_chat_stars_message
  ON chat_message_stars (message_id);
