-- Fix: remove_meeting_participant had no ownership/admin check.
-- Any authenticated user could call this RPC and remove any participant from
-- any meeting. This is a confirmed privilege-escalation vulnerability.
--
-- The function is not called from any frontend code (verified by codebase search).
-- Adding a WHERE clause that gates on meeting creator OR admin.
-- Callers that previously relied on this (none found) would need to be
-- the meeting creator or an admin — exactly the intended access pattern.

CREATE OR REPLACE FUNCTION public.remove_meeting_participant(
  p_meeting_id uuid,
  p_user_id    uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE meetings
  SET participant_user_ids = array_remove(
        COALESCE(participant_user_ids, ARRAY[]::text[]),
        p_user_id::text
      )
  WHERE id = p_meeting_id
    -- Only the meeting creator or an org admin may remove a participant
    AND (
      user_id = auth.uid()
      OR public.is_current_user_admin()
    );
END;
$$;
