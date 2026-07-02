/*
# Add share_note_to_user RPC function

## Problem
The "ارجاع" (assign/share) feature in NotesPage tries to insert a note with
user_id = recipient's UUID. The INSERT RLS policy on `notes` requires
auth.uid() = user_id, so inserting on behalf of another user fails with:
"new row violates row-level security policy for table notes".

## Solution
A SECURITY DEFINER function `share_note_to_user` that runs with elevated privileges,
allowing the current authenticated user to insert a note owned by any recipient.
The function validates that the caller is authenticated before proceeding.

## Security
- SECURITY DEFINER means RLS is bypassed inside this function.
- The caller must be authenticated (auth.uid() IS NOT NULL check).
- Only inserts — no reads, updates, or deletes on other users' data.
*/

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
SET search_path = public
AS $$
BEGIN
  -- Only allow authenticated callers
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO notes (title, content, note_type, status, user_id)
  VALUES (p_title, p_content, p_note_type, 'active', p_recipient_id);
END;
$$;
