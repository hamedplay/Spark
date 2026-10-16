-- Fix recursive RLS evaluation on meeting_inbox INSERT.
-- The previous policy queried public.meetings directly; meetings SELECT policies
-- query meeting_inbox, causing PostgreSQL 42P17 infinite recursion.

DROP POLICY IF EXISTS meeting_organizer_insert_inbox ON public.meeting_inbox;

CREATE POLICY meeting_organizer_insert_inbox
ON public.meeting_inbox
FOR INSERT
TO authenticated
WITH CHECK (
  status = 'pending'
  AND private.is_meeting_owner_for_inbox(meeting_id)
);
