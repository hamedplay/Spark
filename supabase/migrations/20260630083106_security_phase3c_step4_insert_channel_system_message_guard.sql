-- ═══════════════════════════════════════════════════════════════════
-- Step 4: insert_channel_system_message — membership guard
-- ---------------------------------------------------------------
-- Confirmed schema (step 0.1): channel_members.role is text NOT NULL;
-- distinct values in production: 'admin', 'member'.
-- Only 'admin' role members (or the channel creator) may insert
-- system messages. This matches the existing delete_channel_message
-- guard pattern.
--
-- Converted from LANGUAGE sql to plpgsql to support IF guard.
--
-- Caller matrix:
--   service_role (auth.uid() = NULL) → bypass
--   authenticated 'admin' member of channel → allow
--   authenticated 'member' or non-member → RAISE
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.insert_channel_system_message(
  p_channel_id uuid,
  p_body       text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM channel_members
      WHERE channel_id = p_channel_id
        AND user_id    = auth.uid()
        AND role       = 'admin'
    ) AND NOT EXISTS (
      SELECT 1 FROM channels
      WHERE id         = p_channel_id
        AND created_by = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  INSERT INTO channel_messages (channel_id, sender_id, body, message_type, read_by)
  VALUES (p_channel_id, NULL, p_body, 'system', '{}');
END;
$$;
