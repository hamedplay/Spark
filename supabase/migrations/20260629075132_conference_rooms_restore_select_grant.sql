
-- Restore table-level SELECT for anon and authenticated.
-- Without this, INSERT fails with "permission denied" because Postgres needs table-level SELECT
-- for INSERT...RETURNING and realtime subscriptions to work.
GRANT SELECT ON conference_rooms TO anon, authenticated;

-- Revoke SELECT on just the password column (column-level overrides table-level for that specific column).
REVOKE SELECT (password) ON conference_rooms FROM anon, authenticated;
