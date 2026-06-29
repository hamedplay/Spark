-- Update validate_room_join to return ban_reason and ban_expires_at in banned response
CREATE OR REPLACE FUNCTION validate_room_join(
  p_room_id  uuid,
  p_password text    DEFAULT NULL,
  p_user_id  text    DEFAULT NULL
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

  -- Active ban check — also returns reason and expires_at for display
  IF p_user_id IS NOT NULL THEN
    SELECT reason, expires_at INTO v_ban
    FROM banned_users
    WHERE room_id = p_room_id
      AND user_id = p_user_id::text
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1;

    IF FOUND THEN
      -- Lazy cleanup of any expired bans for this user
      DELETE FROM banned_users
      WHERE room_id = p_room_id
        AND user_id = p_user_id::text
        AND expires_at IS NOT NULL
        AND expires_at <= now();

      RETURN jsonb_build_object(
        'allowed',      false,
        'reason',       'banned',
        'ban_reason',   v_ban.reason,
        'ban_expires_at', v_ban.expires_at
      );
    END IF;

    -- Lazy cleanup of expired bans (user is not banned)
    DELETE FROM banned_users
    WHERE room_id = p_room_id
      AND user_id = p_user_id::text
      AND expires_at IS NOT NULL
      AND expires_at <= now();
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
