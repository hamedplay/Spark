CREATE OR REPLACE FUNCTION public.clear_malformed_phone_record(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_session_id uuid;
  v_session_exists boolean := false;
  v_stepup_grant public.session_security_grants%ROWTYPE;
  v_auth_phone text;
  v_profile_phone text;
  v_auth_problem boolean := false;
  v_profile_problem boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  IF NOT private.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_USER_ID');
  END IF;

  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REQUIRED');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth.sessions
    WHERE id = v_session_id
      AND user_id = v_actor
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT au.phone
    INTO v_auth_phone
  FROM auth.users au
  WHERE au.id = p_user_id
  FOR UPDATE;

  SELECT p.phone
    INTO v_profile_phone
  FROM public.profiles p
  WHERE p.user_id = p_user_id
  FOR UPDATE;

  v_auth_problem := private.is_legacy_malformed_phone_value(v_auth_phone);
  v_profile_problem := private.is_legacy_malformed_phone_value(v_profile_phone);

  IF NOT v_auth_problem AND NOT v_profile_problem THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PHONE_NOT_MALFORMED');
  END IF;

  SELECT *
    INTO v_stepup_grant
  FROM public.session_security_grants
  WHERE user_id = v_actor
    AND session_id = v_session_id
    AND grant_type = 'mfa_stepup'
    AND purpose = 'auth_settings_change'
    AND revoked_at IS NULL
    AND consumed_at IS NULL
    AND expires_at > now()
  ORDER BY issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  UPDATE public.session_security_grants
  SET consumed_at = now()
  WHERE id = v_stepup_grant.id;

  IF v_profile_problem THEN
    UPDATE public.profiles
    SET phone = NULL,
        phone_verified_at = NULL
    WHERE user_id = p_user_id
      AND private.is_legacy_malformed_phone_value(phone);
  END IF;

  IF v_auth_problem THEN
    UPDATE auth.users
    SET phone = NULL,
        phone_confirmed_at = NULL,
        phone_change = '',
        phone_change_token = '',
        phone_change_sent_at = NULL,
        updated_at = now()
    WHERE id = p_user_id
      AND private.is_legacy_malformed_phone_value(phone);
  END IF;

  INSERT INTO public.security_audit_events (
    user_id,
    actor_user_id,
    target_user_id,
    event_type,
    event_category,
    severity,
    metadata,
    before_state,
    after_state,
    session_id,
    result
  ) VALUES (
    v_actor,
    v_actor,
    p_user_id,
    'malformed_phone_cleared',
    'settings_change',
    'warning',
    jsonb_build_object(
      'auth_phone_cleared', v_auth_problem,
      'profile_phone_cleared', v_profile_problem
    ),
    jsonb_build_object(
      'auth_phone', CASE WHEN v_auth_problem THEN public.mask_phone_partial(v_auth_phone) ELSE NULL END,
      'profile_phone', CASE WHEN v_profile_problem THEN public.mask_phone_partial(v_profile_phone) ELSE NULL END
    ),
    jsonb_build_object('auth_phone', NULL, 'profile_phone', NULL),
    v_session_id,
    'success'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'auth_phone_cleared', v_auth_problem,
    'profile_phone_cleared', v_profile_problem
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.clear_malformed_phone_record(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_malformed_phone_record(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.clear_malformed_phone_record(uuid) TO authenticated;
