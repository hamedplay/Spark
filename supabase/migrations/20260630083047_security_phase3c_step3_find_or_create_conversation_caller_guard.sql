-- ═══════════════════════════════════════════════════════════════════
-- Step 3: find_or_create_direct_conversation — caller guard
-- ---------------------------------------------------------------
-- Caller matrix:
--   service_role (auth.uid() = NULL) → bypass
--   authenticated user who IS user_a or user_b → allow
--   authenticated user who is neither party → RAISE
--
-- All existing frontend call sites pass user_a = currentUserId
-- (the authenticated caller's own ID), so they all pass the guard.
-- self-chat case (user_a = user_b = auth.uid()) also passes.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.find_or_create_direct_conversation(
  user_a uuid,
  user_b uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  conv_id uuid;
  p_a     uuid;
  p_b     uuid;
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> user_a
     AND auth.uid() <> user_b
  THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Canonical ordering so (A,B) and (B,A) resolve to same row
  IF user_a = user_b THEN
    p_a := user_a; p_b := user_b;
  ELSIF user_a < user_b THEN
    p_a := user_a; p_b := user_b;
  ELSE
    p_a := user_b; p_b := user_a;
  END IF;

  -- Try to find existing (including previously deleted)
  SELECT id INTO conv_id
  FROM chat_conversations
  WHERE ((participant_a = p_a AND participant_b = p_b)
      OR (participant_a = p_b AND participant_b = p_a))
    AND (type = 'direct' OR type IS NULL)
  LIMIT 1;

  IF conv_id IS NOT NULL THEN
    -- Reset the deleted flag for the initiating user (user_a)
    UPDATE chat_conversations
    SET
      deleted_for_a = CASE WHEN participant_a = user_a THEN false ELSE deleted_for_a END,
      deleted_for_b = CASE WHEN participant_b = user_a THEN false ELSE deleted_for_b END
    WHERE id = conv_id;
    RETURN conv_id;
  END IF;

  -- Create new
  INSERT INTO chat_conversations (participant_a, participant_b, type)
  VALUES (p_a, p_b, 'direct')
  ON CONFLICT DO NOTHING
  RETURNING id INTO conv_id;

  IF conv_id IS NULL THEN
    SELECT id INTO conv_id
    FROM chat_conversations
    WHERE participant_a = p_a AND participant_b = p_b
      AND (type = 'direct' OR type IS NULL)
    LIMIT 1;
  END IF;

  RETURN conv_id;
END;
$$;
