/*
# Restrict meeting UPDATE policy to organizer only

## Problem
The existing "Users can update own meetings" UPDATE policy on `meetings`
allowed ANY participant (auth.uid() = ANY(participant_user_ids)) to UPDATE
the meeting row — including status, status_type, calendar_id, request_date,
and all other fields. This was a privilege escalation: a participant could
cancel, reschedule, or approve another organizer's meeting via direct
DB writes or calendar drag/resize.

## Fix
Narrow the UPDATE policy's USING clause to the organizer only
(auth.uid() = user_id). The WITH CHECK already enforced this, but the
USING clause (which rows can be targeted) was too broad. Admins retain
their separate update policy.

## Tables affected
- meetings (RLS policy only — no schema change)

## Security
- Participants can no longer UPDATE meeting rows they don't own.
- Organizers and admins retain full update access.
- No data is modified or lost.
*/

DROP POLICY IF EXISTS "Users can update own meetings" ON meetings;
CREATE POLICY "Users can update own meetings"
ON meetings FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
