-- Fix circular RLS evaluation during organizer cleanup of meeting_inbox rows.
-- The previous DELETE policy queried public.meetings directly. A SELECT policy on
-- public.meetings queries meeting_inbox, creating meeting_inbox -> meetings ->
-- meeting_inbox recursion (Postgres 42P17).

CREATE OR REPLACE FUNCTION private.is_meeting_owner_for_inbox(p_meeting_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.meetings AS m
    WHERE m.id = p_meeting_id
      AND m.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION private.is_meeting_owner_for_inbox(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_meeting_owner_for_inbox(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION private.is_meeting_owner_for_inbox(uuid) TO authenticated;

DROP POLICY IF EXISTS "Organizer can delete meeting inbox entries" ON public.meeting_inbox;

CREATE POLICY "Organizer can delete meeting inbox entries"
ON public.meeting_inbox
FOR DELETE
TO authenticated
USING (
  auth.uid() = user_id
  OR private.is_meeting_owner_for_inbox(meeting_id)
);
