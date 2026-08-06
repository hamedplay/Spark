-- Phase 5B-1 blocker fix: race condition in authorize_password_gateway_session_v1
-- Rewrite function to use INSERT ... ON CONFLICT DO NOTHING ... RETURNING pattern
-- instead of pre-check, eliminating race window.

CREATE OR REPLACE FUNCTION public.authorize_password_gateway_session_v1(
  p_session_id uuid,
  p_user_id uuid,
  p_login_method text,
  p_identifier_hash text,
  p_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_session_created_at timestamptz;
  v_session_not_after timestamptz;
  v_settings_row public.auth_security_settings%ROWTYPE;
  v_method_enabled boolean := false;
  v_inserted_session_id uuid;
  v_existing_user_id uuid;
  v_existing_method text;
BEGIN
  -- Validate all parameters non-null
  IF p_session_id IS NULL OR p_user_id IS NULL OR p_login_method IS NULL
     OR p_identifier_hash IS NULL OR p_ip_hash IS NULL THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;

  -- Validate login method
  IF p_login_method NOT IN ('username', 'email', 'phone', 'public_registration') THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;

  -- Validate hashes are exactly 64 lowercase hex chars
  IF NOT regexp_match(p_identifier_hash, '^[0-9a-f]{64}$') IS NOT NULL THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;
  IF NOT regexp_match(p_ip_hash, '^[0-9a-f]{64}$') IS NOT NULL THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;

  -- Verify session exists in auth.sessions with matching user_id
  BEGIN
    SELECT created_at, not_after INTO v_session_created_at, v_session_not_after
    FROM auth.sessions
    WHERE id = p_session_id AND user_id = p_user_id
    LIMIT 1;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('authorized', false);
  END;

  IF NOT FOUND OR v_session_created_at IS NULL THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;

  -- Session must not be expired
  IF v_session_not_after IS NOT NULL AND v_session_not_after <= now() THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;

  -- For password login methods, verify method was enabled at session creation time
  IF p_login_method IN ('username', 'email', 'phone') THEN
    SELECT * INTO v_settings_row
    FROM public.auth_security_settings
    WHERE id = 1
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('authorized', false);
    END IF;

    v_method_enabled := CASE p_login_method
      WHEN 'username' THEN COALESCE(v_settings_row.username_login, false)
      WHEN 'email' THEN COALESCE(v_settings_row.email_login, false)
      WHEN 'phone' THEN COALESCE(v_settings_row.phone_login, false)
    END;

    IF NOT v_method_enabled THEN
      RETURN jsonb_build_object('authorized', false);
    END IF;
  END IF;
  -- public_registration does not depend on password login method settings

  -- Attempt insert with ON CONFLICT DO NOTHING
  INSERT INTO private.password_gateway_session_authorizations (
    session_id,
    user_id,
    login_method,
    identifier_hash,
    ip_hash,
    auth_session_created_at
  )
  VALUES (
    p_session_id,
    p_user_id,
    p_login_method,
    p_identifier_hash,
    p_ip_hash,
    v_session_created_at
  )
  ON CONFLICT (session_id) DO NOTHING
  RETURNING session_id
  INTO v_inserted_session_id;

  -- If insert succeeded, this is a new authorization
  IF v_inserted_session_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'authorized', true,
      'session_id', p_session_id
    );
  END IF;

  -- Conflict occurred: re-read the existing row
  SELECT user_id, login_method
  INTO v_existing_user_id, v_existing_method
  FROM private.password_gateway_session_authorizations
  WHERE session_id = p_session_id
  LIMIT 1;

  -- Only succeed if existing row matches exactly
  IF v_existing_user_id = p_user_id AND v_existing_method = p_login_method THEN
    RETURN jsonb_build_object(
      'authorized', true,
      'session_id', p_session_id
    );
  END IF;

  -- Different user or method — reject, do not update existing row
  RETURN jsonb_build_object('authorized', false);
END;
$function$;

ALTER FUNCTION public.authorize_password_gateway_session_v1(
  uuid, uuid, text, text, text
) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION
public.authorize_password_gateway_session_v1(
  uuid, uuid, text, text, text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.authorize_password_gateway_session_v1(
  uuid, uuid, text, text, text
)
TO service_role;
