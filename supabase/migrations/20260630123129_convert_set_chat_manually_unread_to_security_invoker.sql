-- Convert set_chat_manually_unread from SECURITY DEFINER to SECURITY INVOKER.
-- Safe because chat_conv_update RLS policy already enforces the same
-- participant_a/participant_b = auth.uid() condition, and the function body
-- also has an identical WHERE clause.
-- Body is preserved byte-for-byte; only SECURITY clause and search_path change.
-- Rollback: change SECURITY INVOKER back to SECURITY DEFINER and search_path to ''

CREATE OR REPLACE FUNCTION public.set_chat_manually_unread(p_conversation_id uuid, p_is_unread boolean)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
BEGIN
UPDATE public.chat_conversations
SET
manually_unread_for_a = CASE WHEN participant_a = auth.uid() THEN p_is_unread ELSE manually_unread_for_a END,
manually_unread_for_b = CASE WHEN participant_b = auth.uid() THEN p_is_unread ELSE manually_unread_for_b END
WHERE id = p_conversation_id
AND (participant_a = auth.uid() OR participant_b = auth.uid());
END;
$function$;
