-- ═══════════════════════════════════════════════════════════════════
-- Step 2: Self-check guard on get_unread_counts and
--         get_channel_unread_counts
-- ---------------------------------------------------------------
-- Caller matrix for both:
--   service_role (auth.uid() = NULL) → bypass (cron / Edge Function)
--   authenticated caller whose p_user_id = auth.uid() → allow
--   authenticated caller with foreign p_user_id → RAISE
--
-- get_unread_counts: converted from LANGUAGE sql STABLE to plpgsql
--   so that the IF guard can be added. STABLE hint is preserved.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_unread_counts(p_user_id uuid)
RETURNS TABLE(conversation_id uuid, unread_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.get_channel_unread_counts(p_user_id uuid)
RETURNS TABLE(channel_id uuid, unread_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;
