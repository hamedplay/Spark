ALTER TABLE conference_rooms
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS speaking_limit_enabled boolean DEFAULT true NOT NULL;
