-- Allow anon (unauthenticated guests) to insert with role='guest' in addition to 'participant'
-- This prevents role escalation: anon cannot insert host/admin/moderator/member
DROP POLICY IF EXISTS "anon_can_join_as_participant" ON conference_participants;

CREATE POLICY "anon_can_join_as_guest_or_participant" ON conference_participants
  FOR INSERT
  TO anon
  WITH CHECK (
    role IN ('guest', 'participant')
    AND EXISTS (
      SELECT 1 FROM conference_rooms cr
      WHERE cr.id = conference_participants.room_id
        AND cr.status <> 'ended'
    )
  );
