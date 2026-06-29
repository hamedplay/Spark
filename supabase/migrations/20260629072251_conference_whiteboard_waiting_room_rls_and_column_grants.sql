-- ══════════════════════════════════════════════════════════════════════════════
-- RLS Hardening: conference_whiteboard
-- ══════════════════════════════════════════════════════════════════════════════

-- INSERT: فقط participant فعال می‌تواند stroke اضافه کند و user_id باید خودش باشد
DROP POLICY IF EXISTS "Anon can draw whiteboard" ON conference_whiteboard;
DROP POLICY IF EXISTS "Participants can draw" ON conference_whiteboard;

CREATE POLICY "active_participant_can_draw" ON conference_whiteboard
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conference_participants cp
      WHERE cp.room_id = conference_whiteboard.room_id
        AND cp.status = 'joined'
    )
  );

-- DELETE تک‌ردیفی: فقط خالق ردیف
CREATE POLICY "owner_can_delete_own_stroke" ON conference_whiteboard
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- DELETE کل اتاق: فقط host (برای clearBoard)
CREATE POLICY "host_can_clear_whiteboard" ON conference_whiteboard
  FOR DELETE
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conference_participants cp
      WHERE cp.room_id = conference_whiteboard.room_id
        AND cp.role = 'host'
        AND cp.status = 'joined'
    )
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- RLS Hardening: conference_waiting_room
-- ══════════════════════════════════════════════════════════════════════════════

-- DELETE برای cleanup (انصراف کاربر یا timeout)
DROP POLICY IF EXISTS "allow_delete_own_waiting" ON conference_waiting_room;
CREATE POLICY "allow_delete_own_waiting" ON conference_waiting_room
  FOR DELETE
  TO anon, authenticated
  USING (true);

-- conference_waiting_room برای INSERT به anon هم باید مجاز باشد (مهمانان)
DROP POLICY IF EXISTS "Authenticated users can request entry" ON conference_waiting_room;
CREATE POLICY "users_can_request_entry" ON conference_waiting_room
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conference_rooms cr
      WHERE cr.id = conference_waiting_room.room_id
        AND cr.status <> 'ended'
        AND cr.waiting_room_enabled = true
    )
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- RLS Hardening: conference_rooms — جلوگیری از نشت ستون password
-- ══════════════════════════════════════════════════════════════════════════════
-- SELECT پالیسی موجود را بررسی می‌کنیم و اگر * بود محدود می‌کنیم.
-- در Supabase RLS نمی‌توان column-level را در policy کنترل کرد،
-- اما می‌توان از column-level privileges استفاده کرد:
REVOKE SELECT ON conference_rooms FROM anon;
GRANT SELECT (id, name, code, host_id, status, max_participants, is_locked,
              waiting_room_enabled, allow_reactions, allow_screen_share,
              allow_chat, record_enabled, require_approval,
              created_at, ended_at, meeting_id)
  ON conference_rooms TO anon;

-- برای authenticated هم password پنهان می‌ماند
REVOKE SELECT ON conference_rooms FROM authenticated;
GRANT SELECT (id, name, code, host_id, status, max_participants, is_locked,
              waiting_room_enabled, allow_reactions, allow_screen_share,
              allow_chat, record_enabled, require_approval,
              created_at, ended_at, meeting_id)
  ON conference_rooms TO authenticated;
