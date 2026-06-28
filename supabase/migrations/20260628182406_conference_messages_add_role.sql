
-- Add role column to conference_messages for system/admin/moderator message differentiation
ALTER TABLE conference_messages
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'
  CHECK (role IN ('admin', 'moderator', 'user', 'system'));

CREATE INDEX IF NOT EXISTS idx_conf_messages_role ON conference_messages(room_id, role);
