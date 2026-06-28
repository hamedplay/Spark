-- Expand role values: drop old 2-value constraint, migrate 'participant'→'member', add full 5-role constraint

-- Step 1: drop old constraint
ALTER TABLE conference_participants
  DROP CONSTRAINT conference_participants_role_check;

-- Step 2: rename old 'participant' rows → 'member' (keep existing 'host' rows unchanged)
UPDATE conference_participants
  SET role = 'member'
  WHERE role = 'participant';

-- Step 3: change default to 'member'
ALTER TABLE conference_participants
  ALTER COLUMN role SET DEFAULT 'member';

-- Step 4: add new constraint covering all five roles
ALTER TABLE conference_participants
  ADD CONSTRAINT conference_participants_role_check
  CHECK (role = ANY (ARRAY['host','admin','moderator','member','guest']));

-- Step 5: index to speed up role-based permission queries
CREATE INDEX IF NOT EXISTS idx_conf_participants_role
  ON conference_participants (room_id, role);

-- Step 6: update host participants' role to 'host' based on current room host_id
-- (repairs any rows that were set to 'member' but actually belong to the room host)
UPDATE conference_participants cp
SET role = 'host'
FROM conference_rooms cr
WHERE cp.room_id = cr.id
  AND cp.user_id = cr.host_id
  AND cp.role != 'host';
