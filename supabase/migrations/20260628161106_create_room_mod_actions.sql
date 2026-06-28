CREATE TABLE IF NOT EXISTS room_mod_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES conference_rooms(id) ON DELETE CASCADE,
  by_admin_id text NOT NULL,
  target_user_id text NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('mute','kick','ban')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE room_mod_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_mod_actions" ON room_mod_actions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert_mod_actions" ON room_mod_actions FOR INSERT
  TO authenticated WITH CHECK (auth.uid()::text = by_admin_id);

CREATE POLICY "update_mod_actions" ON room_mod_actions FOR UPDATE
  TO authenticated USING (auth.uid()::text = by_admin_id) WITH CHECK (auth.uid()::text = by_admin_id);

CREATE POLICY "delete_mod_actions" ON room_mod_actions FOR DELETE
  TO authenticated USING (auth.uid()::text = by_admin_id);

CREATE INDEX idx_room_mod_actions_room_id ON room_mod_actions(room_id);
CREATE INDEX idx_room_mod_actions_target_user ON room_mod_actions(target_user_id);
