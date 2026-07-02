/*
# Sync channel member_count with trigger

## Problem
The `channels.member_count` field is a denormalized counter that drifts out of sync
with the actual rows in `channel_members`. When members are removed, the counter is
never decremented from the frontend, causing the header to show incorrect counts.

## Changes
1. Adds a trigger function `update_channel_member_count()` that recalculates the
   exact member count from `channel_members` whenever a row is inserted or deleted.
2. Attaches the trigger to `channel_members` AFTER INSERT and AFTER DELETE.
3. Corrects all existing stale `member_count` values immediately via an UPDATE.
*/

-- Trigger function: recounts members on insert/delete
CREATE OR REPLACE FUNCTION public.update_channel_member_count()
RETURNS TRIGGER AS $$
DECLARE
  v_channel_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_channel_id := OLD.channel_id;
  ELSE
    v_channel_id := NEW.channel_id;
  END IF;

  UPDATE channels
  SET member_count = (
    SELECT COUNT(*) FROM channel_members WHERE channel_id = v_channel_id
  )
  WHERE id = v_channel_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger (drop first for idempotency)
DROP TRIGGER IF EXISTS trg_channel_member_count ON channel_members;
CREATE TRIGGER trg_channel_member_count
AFTER INSERT OR DELETE ON channel_members
FOR EACH ROW EXECUTE FUNCTION public.update_channel_member_count();

-- Fix all existing stale counts now
UPDATE channels c
SET member_count = (
  SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id = c.id
);
