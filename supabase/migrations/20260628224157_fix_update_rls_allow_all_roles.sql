
-- Fix kicked user can't rejoin: UPDATE policy WITH CHECK previously only allowed role='participant'.
-- Kicked users have role='member' so the upsert UPDATE step was rejected.
-- Now allow all valid roles (permission to set host role is still gated by room ownership check).

DROP POLICY IF EXISTS "auth_can_update_own_participant" ON conference_participants;
CREATE POLICY "auth_can_update_own_participant" ON conference_participants FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      role IN ('participant', 'member', 'admin', 'moderator', 'guest')
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

DROP POLICY IF EXISTS "anon_can_update_own_participant" ON conference_participants;
CREATE POLICY "anon_can_update_own_participant" ON conference_participants FOR UPDATE
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM conference_rooms cr
      WHERE cr.id = conference_participants.room_id
        AND cr.status <> 'ended'
    )
  )
  WITH CHECK (
    role IN ('participant', 'member', 'guest')
    AND EXISTS (
      SELECT 1 FROM conference_rooms cr
      WHERE cr.id = conference_participants.room_id
        AND cr.status <> 'ended'
    )
  );
