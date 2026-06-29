-- 1. Add missing UPDATE policy for banned_users (without it, upsert silently fails on existing rows)
CREATE POLICY "update_bans_auth" ON banned_users
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- 2. Fix validate_room_join: user_id column is UUID, cast p_user_id to uuid for proper comparison.
--    Also fix the DELETE inside IF FOUND (it was running when ban IS active — pointless and wrong)
CREATE OR REPLACE FUNCTION validate_room_join(
  p_room_id  uuid,
  p_password text DEFAULT NULL,
  p_user_id  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room       record;
  v_count      integer;
  v_ban        record;
  v_uid        uuid;
BEGIN
  SELECT id, password, is_locked, status, max_participants
  INTO v_room
  FROM conference_rooms
  WHERE id = p_room_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'room_not_found');
  END IF;

  IF v_room.status = 'ended' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'room_ended');
  END IF;

  IF v_room.is_locked THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'room_locked');
  END IF;

  -- Active ban check
  IF p_user_id IS NOT NULL THEN
    -- Try to cast to uuid; fall back to null if it's a non-uuid guest id
    BEGIN
      v_uid := p_user_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_uid := NULL;
    END;

    IF v_uid IS NOT NULL THEN
      -- Lazy cleanup of expired bans first
      DELETE FROM banned_users
      WHERE room_id = p_room_id
        AND user_id = v_uid
        AND expires_at IS NOT NULL
        AND expires_at <= now();

      -- Now check for an active ban
      SELECT reason, expires_at INTO v_ban
      FROM banned_users
      WHERE room_id = p_room_id
        AND user_id = v_uid
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1;

      IF FOUND THEN
        RETURN jsonb_build_object(
          'allowed',        false,
          'reason',         'banned',
          'ban_reason',     v_ban.reason,
          'ban_expires_at', v_ban.expires_at
        );
      END IF;
    END IF;
  END IF;

  IF v_room.password IS NOT NULL AND v_room.password <> '' THEN
    IF p_password IS NULL OR p_password = '' OR v_room.password <> p_password THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'wrong_password');
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM conference_participants
  WHERE room_id = p_room_id AND status = 'joined';

  IF v_count >= v_room.max_participants THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'room_full');
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', 'ok');
END;
$$;

REVOKE ALL ON FUNCTION validate_room_join(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_room_join(uuid, text, text) TO anon, authenticated;
