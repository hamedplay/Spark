-- Fix: toggle_pin_chat was the only SECURITY DEFINER function without SET search_path.
-- This is a genuine Search Path Mutable finding for a SECURITY DEFINER function —
-- not a false positive. Without a fixed search_path, a user-controlled schema
-- earlier in the path could shadow public objects.
-- Change is purely additive: same body, same signature, same behavior.

CREATE OR REPLACE FUNCTION public.toggle_pin_chat(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.chat_conversations
  SET
    pinned_for_a = CASE WHEN participant_a = auth.uid() THEN NOT pinned_for_a ELSE pinned_for_a END,
    pinned_for_b = CASE WHEN participant_b = auth.uid() THEN NOT pinned_for_b ELSE pinned_for_b END
  WHERE id = p_conversation_id
    AND (participant_a = auth.uid() OR participant_b = auth.uid());
END;
$$;
