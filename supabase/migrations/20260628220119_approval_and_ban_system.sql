-- Add require_approval to conference_rooms
ALTER TABLE conference_rooms ADD COLUMN IF NOT EXISTS require_approval BOOLEAN NOT NULL DEFAULT false;

-- pending_approvals table
CREATE TABLE IF NOT EXISTS pending_approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES conference_rooms(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  approved_by UUID,
  expires_at  TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '5 minutes')
);
ALTER TABLE pending_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_pending_approvals_auth"   ON pending_approvals FOR SELECT TO authenticated USING (true);
CREATE POLICY "select_pending_approvals_anon"   ON pending_approvals FOR SELECT TO anon           USING (true);
CREATE POLICY "insert_pending_approvals_auth"   ON pending_approvals FOR INSERT TO authenticated  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "insert_pending_approvals_anon"   ON pending_approvals FOR INSERT TO anon           WITH CHECK (true);
CREATE POLICY "update_pending_approvals_auth"   ON pending_approvals FOR UPDATE TO authenticated  USING (true) WITH CHECK (true);

-- banned_users table
CREATE TABLE IF NOT EXISTS banned_users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID NOT NULL REFERENCES conference_rooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  banned_by    UUID,
  reason       TEXT,
  banned_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);
ALTER TABLE banned_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_bans_auth"  ON banned_users FOR SELECT TO authenticated USING (true);
CREATE POLICY "select_bans_anon"  ON banned_users FOR SELECT TO anon           USING (true);
CREATE POLICY "insert_bans_auth"  ON banned_users FOR INSERT TO authenticated  WITH CHECK (true);
CREATE POLICY "delete_bans_auth"  ON banned_users FOR DELETE TO authenticated  USING (true);
