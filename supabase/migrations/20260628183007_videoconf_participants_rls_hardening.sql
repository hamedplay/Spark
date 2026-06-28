
-- Fix role spoofing: auth users cannot set role='host' unless they own the room
DROP POLICY IF EXISTS "Authenticated users can join rooms" ON conference_participants;
CREATE POLICY "auth_can_join_rooms" ON conference_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      role = 'participant'
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

-- Fix role spoofing on UPDATE: auth users cannot promote themselves to host
DROP POLICY IF EXISTS "Participants can update their own record" ON conference_participants;
CREATE POLICY "auth_can_update_own_participant" ON conference_participants FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      role = 'participant'
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

-- Fix anon INSERT: guests can only join as participant, never as host
DROP POLICY IF EXISTS "Anon can insert participants" ON conference_participants;
CREATE POLICY "anon_can_join_as_participant" ON conference_participants FOR INSERT
  TO anon
  WITH CHECK (
    role = 'participant'
    AND EXISTS (
      SELECT 1 FROM conference_rooms cr
      WHERE cr.id = conference_participants.room_id
        AND cr.status <> 'ended'
    )
  );

-- Fix anon UPDATE: guests cannot change their own role to host
DROP POLICY IF EXISTS "Anon can update own participant" ON conference_participants;
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
    role = 'participant'
    AND EXISTS (
      SELECT 1 FROM conference_rooms cr
      WHERE cr.id = conference_participants.room_id
        AND cr.status <> 'ended'
    )
  );
