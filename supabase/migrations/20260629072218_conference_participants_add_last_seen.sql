-- ستون last_seen برای heartbeat کاربران در conference
ALTER TABLE conference_participants
  ADD COLUMN IF NOT EXISTS last_seen timestamptz DEFAULT now();

-- index برای کارایی reaper query
CREATE INDEX IF NOT EXISTS idx_conf_participants_last_seen
  ON conference_participants(last_seen)
  WHERE status = 'joined';
