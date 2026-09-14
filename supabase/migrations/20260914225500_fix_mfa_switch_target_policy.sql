-- Keep the server-side switch gate aligned with the same TOTP policy exposed to users.
-- A disabled global MFA policy must not allow a normal user to begin a switch to a
-- brand-new TOTP factor merely because allow_totp_mfa is true.

CREATE OR REPLACE FUNCTION private.begin_mfa_method_switch_impl(p_to_method text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session uuid;
  v_from text;
  v_id uuid;
  v_epoch bigint;
  v_account_status text;
  v_is_active boolean;
  v_is_security_admin boolean := false;
  v_user_requires_mfa boolean := false;
  v_has_totp boolean := false;
  v_has_phone boolean := false;
  v_policy text := 'disabled';
  v_allow_totp boolean := false;
  v_sms_allowed boolean := false;
  v_totp_selectable boolean := false;
BEGIN
  IF v_uid IS NULL OR p_to_method NOT IN ('totp', 'sms') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST');
  END IF;

  BEGIN
    v_session := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END;

  SELECT
    p.mfa_method,
    COALESCE(p.auth_epoch, 1),
    p.account_status,
    p.is_active,
    COALESCE(p.is_security_admin, false),
    COALESCE(p.mfa_enrollment_required, false)
  INTO
    v_from,
    v_epoch,
    v_account_status,
    v_is_active,
    v_is_security_admin,
    v_user_requires_mfa
  FROM public.profiles p
  WHERE p.user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND OR v_is_active IS NOT TRUE OR v_account_status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_ACTIVE');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.sessions a
    JOIN public.session_security_state s
      ON s.session_id = a.id
     AND s.user_id = a.user_id
    WHERE a.id = v_session
      AND a.user_id = v_uid
      AND (a.not_after IS NULL OR a.not_after > now())
      AND s.revoked_at IS NULL
      AND s.idle_expiry_at > now()
      AND s.absolute_expiry_at > now()
      AND s.auth_epoch = v_epoch
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  IF v_from IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_MFA');
  END IF;

  IF v_from = p_to_method THEN
    RETURN jsonb_build_object('ok', true, 'already_active', true, 'mfa_method', v_from);
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM auth.mfa_factors f
    WHERE f.user_id = v_uid
      AND f.factor_type = 'totp'
      AND f.status = 'verified'
  ) INTO v_has_totp;

  SELECT EXISTS(
    SELECT 1
    FROM auth.users u
    WHERE u.id = v_uid
      AND u.phone IS NOT NULL
      AND btrim(u.phone) <> ''
      AND u.phone_confirmed_at IS NOT NULL
  ) INTO v_has_phone;

  SELECT
    COALESCE(s.mfa_policy, 'disabled'),
    COALESCE(s.allow_totp_mfa, false),
    COALESCE(s.custom_mfa_enabled, false)
      AND 'sms' = ANY(COALESCE(s.custom_mfa_allowed_factors, ARRAY[]::text[]))
      AND EXISTS(SELECT 1 FROM public.sms_providers sp WHERE sp.is_active IS TRUE)
  INTO v_policy, v_allow_totp, v_sms_allowed
  FROM public.auth_security_settings s
  WHERE s.id = 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND');
  END IF;

  v_totp_selectable :=
    v_has_totp
    OR v_is_security_admin
    OR (
      v_allow_totp
      AND (v_policy <> 'disabled' OR v_user_requires_mfa)
    );

  IF p_to_method = 'totp' AND NOT v_totp_selectable THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOTP_NOT_AVAILABLE');
  END IF;

  IF p_to_method = 'sms' AND (NOT v_sms_allowed OR NOT v_has_phone) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', CASE WHEN NOT v_has_phone THEN 'PHONE_NOT_CONFIRMED' ELSE 'SMS_MFA_NOT_AVAILABLE' END
    );
  END IF;

  UPDATE public.mfa_switch_intents
  SET status = CASE WHEN expires_at <= now() THEN 'expired' ELSE 'cancelled' END
  WHERE user_id = v_uid
    AND status IN ('pending_stepup', 'ready', 'pending_enrollment');

  INSERT INTO public.mfa_switch_intents(
    user_id, session_id, from_method, to_method, status, expires_at
  ) VALUES (
    v_uid, v_session, v_from, p_to_method, 'pending_stepup', now() + interval '10 minutes'
  )
  RETURNING id INTO v_id;

  INSERT INTO public.security_audit_events(
    user_id, actor_user_id, target_user_id,
    event_type, event_category, severity,
    session_id, result, metadata
  ) VALUES (
    v_uid, v_uid, v_uid,
    'mfa_method_switch_started', 'mfa', 'info',
    v_session, 'success',
    jsonb_build_object('from_method', v_from, 'to_method', p_to_method, 'intent_id', v_id::text)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'intent_id', v_id,
    'from_method', v_from,
    'to_method', p_to_method,
    'requires_current_factor_proof', true
  );
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'SWITCH_IN_PROGRESS');
END;
$function$;

NOTIFY pgrst, 'reload schema';
