-- Add reply support to conference messages
ALTER TABLE conference_messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES conference_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reply_to_body text,
  ADD COLUMN IF NOT EXISTS reply_to_name text,
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

-- updated_at on conference_participants for heartbeat
ALTER TABLE conference_participants
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Reactions persistence table
CREATE TABLE IF NOT EXISTS conference_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES conference_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  display_name text NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conference_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_conf_reactions" ON conference_reactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_conf_reactions" ON conference_reactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_conf_reactions" ON conference_reactions FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "update_conf_reactions" ON conference_reactions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_conf_reactions_room ON conference_reactions(room_id, created_at DESC);
