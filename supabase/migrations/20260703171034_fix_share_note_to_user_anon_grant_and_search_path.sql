-- Fix: share_note_to_user had EXECUTE granted to 'anon' (unauthenticated role).
-- Although the function raises an exception when auth.uid() IS NULL, the grant
-- itself is incorrect — an anon caller should never be able to invoke a function
-- that writes to the notes table.
-- The only frontend caller is NotesPage.tsx which runs as an authenticated user,
-- so revoking from anon has zero functional impact.
--
-- Additionally, the function was missing 'pg_temp' in its search_path, which
-- Security Advisor flags as a schema-injection vector for SECURITY DEFINER functions.

REVOKE EXECUTE ON FUNCTION public.share_note_to_user(text, text, text, uuid, uuid)
  FROM anon;

-- Redefine the function with a hardened search_path that includes pg_temp
CREATE OR REPLACE FUNCTION public.share_note_to_user(
  p_title      text,
  p_content    text,
  p_note_type  text,
  p_recipient_id uuid,
  p_sender_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO notes (title, content, note_type, status, user_id)
  VALUES (p_title, p_content, p_note_type, 'active', p_recipient_id);
END;
$$;
