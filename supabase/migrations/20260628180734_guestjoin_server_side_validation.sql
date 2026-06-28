-- Server-side function to validate room join request without exposing password to client.
-- Returns: { allowed: bool, reason: text }
CREATE OR REPLACE FUNCTION validate_room_join(
  p_room_id uuid,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room record;
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

  IF v_room.password IS NOT NULL AND v_room.password <> '' THEN
    IF p_password IS NULL OR p_password = '' OR v_room.password <> p_password THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'wrong_password');
    END IF;
  END IF;

  -- Check participant count
  DECLARE
    v_count integer;
  BEGIN
    SELECT COUNT(*) INTO v_count
    FROM conference_participants
    WHERE room_id = p_room_id AND status = 'joined';

    IF v_count >= v_room.max_participants THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'room_full');
    END IF;
  END;

  RETURN jsonb_build_object('allowed', true, 'reason', 'ok');
END;
$$;

-- Revoke public access; allow anon + authenticated (guests are anon)
REVOKE ALL ON FUNCTION validate_room_join(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_room_join(uuid, text) TO anon, authenticated;

-- Function to check if room has a password (boolean only — never returns the password)
CREATE OR REPLACE FUNCTION room_has_password(p_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_password text;
BEGIN
  SELECT password INTO v_password
  FROM conference_rooms
  WHERE id = p_room_id;
  RETURN v_password IS NOT NULL AND v_password <> '';
END;
$$;

REVOKE ALL ON FUNCTION room_has_password(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION room_has_password(uuid) TO anon, authenticated;
