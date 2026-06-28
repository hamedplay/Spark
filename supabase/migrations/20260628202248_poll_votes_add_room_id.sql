
-- Add room_id to conference_poll_votes for easier RLS / querying
ALTER TABLE conference_poll_votes ADD COLUMN IF NOT EXISTS room_id uuid;

-- Backfill from the related poll
UPDATE conference_poll_votes cpv
SET room_id = cp.room_id
FROM conference_polls cp
WHERE cpv.poll_id = cp.id AND cpv.room_id IS NULL;

-- Make non-null going forward (existing rows are backfilled)
ALTER TABLE conference_poll_votes ALTER COLUMN room_id SET NOT NULL;

-- Index for fast queries by room
CREATE INDEX IF NOT EXISTS idx_conf_poll_votes_room_id ON conference_poll_votes (room_id);

-- Ensure one vote per user per poll (DB-level guarantee)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conf_poll_votes_unique_user_poll'
  ) THEN
    ALTER TABLE conference_poll_votes
      ADD CONSTRAINT conf_poll_votes_unique_user_poll UNIQUE (poll_id, user_id);
  END IF;
END $$;
