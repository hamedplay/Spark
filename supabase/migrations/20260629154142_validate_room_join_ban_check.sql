-- Update validate_room_join to accept user_id and check active bans (expires_at aware)
CREATE OR REPLACE FUNCTION validate_room_join(
  p_room_id  uuid,
  p_password text    DEFAULT NULL,
  p_user_id  text    DEFAULT NULL   -- guest_id or auth user_id
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room  record;
  v_count integer;
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

  -- Active ban check: record exists AND (expires_at IS NULL OR expires_at > now())
  IF p_user_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM banned_users
      WHERE room_id = p_room_id
        AND user_id = p_user_id::text
        AND (expires_at IS NULL OR expires_at > now())
    ) THEN
      -- Lazy cleanup: delete any expired bans for this user while we're here
      DELETE FROM banned_users
      WHERE room_id = p_room_id
        AND user_id = p_user_id::text
        AND expires_at IS NOT NULL
        AND expires_at <= now();

      RETURN jsonb_build_object('allowed', false, 'reason', 'banned');
    END IF;

    -- Cleanup expired bans for this user (so the table stays tidy)
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

  -- Participant count check
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
