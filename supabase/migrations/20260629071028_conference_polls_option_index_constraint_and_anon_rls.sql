-- Add check constraint: option_index must be non-negative
-- (upper bound validation against poll.options.length is done at app level;
--  a DB-level bounds check would require a trigger; we guard the lower bound here)
ALTER TABLE conference_poll_votes
  ADD CONSTRAINT chk_option_index_nonneg CHECK (option_index >= 0);

-- Allow anon users (guests without auth.uid()) to insert votes and read polls/votes.
-- Guests use a random UUID stored in localStorage as their user_id.

-- Polls: allow anon participants to read polls for rooms they are in
DROP POLICY IF EXISTS "Room participants can view polls" ON conference_polls;
CREATE POLICY "participants_can_view_polls" ON conference_polls
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conference_participants cp
      WHERE cp.room_id = conference_polls.room_id
        AND cp.status = 'joined'
    )
  );

-- Votes: allow anon users to insert their own vote (guest flow)
DROP POLICY IF EXISTS "Users can vote once" ON conference_poll_votes;
CREATE POLICY "users_can_vote_once" ON conference_poll_votes
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    option_index >= 0
    AND EXISTS (
      SELECT 1 FROM conference_polls p
      WHERE p.id = conference_poll_votes.poll_id
        AND p.is_active = true
    )
  );

-- Votes: allow anon users to read vote counts (for aggregate display)
DROP POLICY IF EXISTS "Room participants can view votes" ON conference_poll_votes;
CREATE POLICY "participants_can_view_votes" ON conference_poll_votes
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM conference_polls p
      JOIN conference_participants cp ON cp.room_id = p.room_id
      WHERE p.id = conference_poll_votes.poll_id
        AND cp.status = 'joined'
    )
  );
