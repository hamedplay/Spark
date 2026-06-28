DROP POLICY IF EXISTS "auth_can_join_rooms" ON conference_participants;

CREATE POLICY "auth_can_join_rooms" ON conference_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      role IN ('participant', 'member')
      OR (
        role = 'host'
        AND EXISTS (
          SELECT 1 FROM conference_rooms cr
          WHERE cr.id = conference_participants.room_id
            AND cr.host_id = auth.uid()
        )
      )
    )
  );