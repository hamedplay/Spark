ALTER TABLE banned_users
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;

-- ایندکس برای چک سریع ورود (room_id + user_id + expires_at)
CREATE INDEX IF NOT EXISTS idx_banned_users_lookup
  ON banned_users (room_id, user_id, expires_at);
