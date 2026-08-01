-- Drop the old overload of manage_minutes_decision that lacks p_remind_at.
-- The new version (with p_remind_at) is the one all callers should use.
DROP FUNCTION IF EXISTS public.manage_minutes_decision(
  uuid, timestamptz, text, text, text, text, jsonb, uuid
);
