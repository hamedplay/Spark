
-- 1. Unique constraint: one vote per user per poll
ALTER TABLE conference_poll_votes
  ADD CONSTRAINT unique_vote_per_user UNIQUE (poll_id, user_id);

-- 2. Ensure RLS is enabled
ALTER TABLE conference_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE conference_poll_votes ENABLE ROW LEVEL SECURITY;

-- 3. Replace INSERT policy: only room hosts may create polls
DROP POLICY IF EXISTS "Host can create polls" ON conference_polls;
CREATE POLICY "host_can_create_poll" ON conference_polls FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1 FROM conference_participants cp
      WHERE cp.room_id = conference_polls.room_id
        AND cp.user_id = auth.uid()
        AND cp.role = 'host'
    )
  );

-- 4. Add missing DELETE policy (was completely absent)
DROP POLICY IF EXISTS "host_can_delete_poll" ON conference_polls;
CREATE POLICY "host_can_delete_poll" ON conference_polls FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

-- 5. Tighten UPDATE policy: only creator (who must be host) can close
DROP POLICY IF EXISTS "Host can update polls" ON conference_polls;
CREATE POLICY "host_can_update_poll" ON conference_polls FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- 6. Cascade delete votes when poll is deleted (already CASCADE via FK usually, ensure it)
-- conference_poll_votes.poll_id already references conference_polls(id), verify cascade
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc ON rc.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'conference_poll_votes'
      AND rc.delete_rule = 'CASCADE'
  ) THEN
    ALTER TABLE conference_poll_votes
      DROP CONSTRAINT IF EXISTS conference_poll_votes_poll_id_fkey;
    ALTER TABLE conference_poll_votes
      ADD CONSTRAINT conference_poll_votes_poll_id_fkey
      FOREIGN KEY (poll_id) REFERENCES conference_polls(id) ON DELETE CASCADE;
  END IF;
END $$;
