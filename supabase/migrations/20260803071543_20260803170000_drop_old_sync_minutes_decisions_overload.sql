-- Drop the old 2-argument _sync_minutes_decisions overload
-- The new 3-argument version (with p_deleted_decision_ids) is the correct one.
DROP FUNCTION IF EXISTS public._sync_minutes_decisions(uuid, jsonb);
