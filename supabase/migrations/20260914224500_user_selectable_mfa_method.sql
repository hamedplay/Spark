-- User-selectable canonical MFA method.
--
-- Goals:
--   * expose the effective TOTP/SMS choices to the authenticated user;
--   * require proof of the current factor before switching methods;
--   * require proof/enrollment of the target factor before the switch completes;
--   * make profiles.mfa_method write-only through canonical security flows.

CREATE OR REPLACE FUNCTION public.guard_canonical_mfa_method()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.mfa_method IS NOT NULL
       AND COALESCE(current_setting('app.mfa_method_write', true), '') <> 'true'
       AND COALESCE(current_setting('app.account_lifecycle_write', true), '') <> 'true'
    THEN
      RAISE EXCEPTION 'mfa_method must be changed through the canonical MFA flow'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.mfa_method IS DISTINCT FROM OLD.mfa_method
     AND COALESCE(current_setting('app.mfa_method_write', true), '') <> 'true'
     AND COALESCE(current_setting('app.account_lifecycle_write', true), '') <> 'true'
  THEN
    RAISE EXCEPTION 'mfa_method must be changed through the canonical MFA flow'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_canonical_mfa_method ON public.profiles;
CREATE TRIGGER trg_guard_canonical_mfa_method
BEFORE INSERT OR UPDATE OF mfa_method ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_canonical_mfa_method();

REVOKE ALL ON FUNCTION public.guard_canonical_mfa_method() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_canonical_mfa_method() FROM anon;
REVOKE ALL ON FUNCTION public.guard_canonical_mfa_method() FROM authenticated;

CREATE OR REPLACE FUNCTION private.get_my_canonical_mfa_state_impl()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_method text;
  v_totp boolean := false;
  v_sms boolean := false;
  v_is_security_admin boolean := false;
  v_user_requires_mfa boolean := false;
  v_policy text := 'disabled';
  v_allow_totp boolean := false;
  v_custom_sms_enabled boolean := false;
  v_sms_provider_ready boolean := false;
  v_can_enroll_totp boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT
    p.mfa_method,
    u.phone,
    COALESCE(p.is_security_admin, false),
    COALESCE(p.mfa_enrollment_required, false)
  INTO
    v_method,
    v_phone,
    v_is_security_admin,
    v_user_requires_mfa
  FROM public.profiles p
  LEFT JOIN auth.users u
    ON u.id = p.user_id
   AND u.phone_confirmed_at IS NOT NULL
  WHERE p.user_id = v_uid
    AND p.is_active IS TRUE
    AND p.account_status = 'ACTIVE'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_ACTIVE');
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM auth.mfa_factors f
    WHERE f.user_id = v_uid
      AND f.factor_type = 'totp'
      AND f.status = 'verified'
  ) INTO v_totp;

  SELECT EXISTS(
    SELECT 1
    FROM public.custom_mfa_factors f
    WHERE f.user_id = v_uid
      AND f.factor_type = 'sms'
      AND f.factor_status = 'active'
  ) INTO v_sms;

  SELECT
    COALESCE(s.mfa_policy, 'disabled'),
    COALESCE(s.allow_totp_mfa, false),
    COALESCE(s.custom_mfa_enabled, false)
      AND 'sms' = ANY(COALESCE(s.custom_mfa_allowed_factors, ARRAY[]::text[]))
  INTO v_policy, v_allow_totp, v_custom_sms_enabled
  FROM public.auth_security_settings s
  WHERE s.id = 1
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.sms_providers sp WHERE sp.is_active IS TRUE
  ) INTO v_sms_provider_ready;

  v_can_enroll_totp :=
    v_is_security_admin
    OR (
      v_allow_totp
      AND (v_policy <> 'disabled' OR v_user_requires_mfa)
    );

  RETURN jsonb_build_object(
    'ok', true,
    'mfa_method', v_method,
    'mfa_policy', v_policy,
    'has_verified_totp', v_totp,
    'has_active_sms_factor', v_sms,
    'has_confirmed_phone', v_phone IS NOT NULL,
    'masked_phone', CASE
      WHEN v_phone IS NULL THEN NULL
      ELSE left(v_phone, 3) || repeat('*', greatest(length(v_phone) - 6, 1)) || right(v_phone, 3)
    END,
    'can_enroll_totp', v_can_enroll_totp,
    'totp_selectable', v_totp OR v_can_enroll_totp,
    'sms_enabled_by_admin', v_custom_sms_enabled,
    'sms_provider_ready', v_sms_provider_ready,
    'sms_selectable', v_custom_sms_enabled AND v_sms_provider_ready AND v_phone IS NOT NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_canonical_mfa_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.get_my_canonical_mfa_state_impl();
$function$;

REVOKE ALL ON FUNCTION public.get_my_canonical_mfa_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_canonical_mfa_state() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_canonical_mfa_state() TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_my_canonical_mfa_state_impl() TO authenticated;

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
  v_has_totp boolean := false;
  v_has_phone boolean := false;
  v_totp_allowed boolean := false;
  v_sms_allowed boolean := false;
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
    p.is_active
  INTO v_from, v_epoch, v_account_status, v_is_active
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
    COALESCE(s.allow_totp_mfa, false),
    COALESCE(s.custom_mfa_enabled, false)
      AND 'sms' = ANY(COALESCE(s.custom_mfa_allowed_factors, ARRAY[]::text[]))
      AND EXISTS(SELECT 1 FROM public.sms_providers sp WHERE sp.is_active IS TRUE)
  INTO v_totp_allowed, v_sms_allowed
  FROM public.auth_security_settings s
  WHERE s.id = 1;

  IF p_to_method = 'totp' AND NOT (v_has_totp OR v_totp_allowed) THEN
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

CREATE OR REPLACE FUNCTION public.begin_mfa_method_switch(p_to_method text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.begin_mfa_method_switch_impl($1);
$function$;

REVOKE ALL ON FUNCTION public.begin_mfa_method_switch(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_mfa_method_switch(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.begin_mfa_method_switch(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.begin_mfa_method_switch_impl(text) TO authenticated;

CREATE OR REPLACE FUNCTION private.confirm_mfa_method_switch_current_impl(p_intent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session uuid;
  v_intent public.mfa_switch_intents%ROWTYPE;
  v_method text;
  v_proof_time timestamptz;
BEGIN
  IF v_uid IS NULL OR p_intent_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST');
  END IF;

  BEGIN
    v_session := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END;

  SELECT * INTO v_intent
  FROM public.mfa_switch_intents i
  WHERE i.id = p_intent_id
    AND i.user_id = v_uid
    AND i.session_id = v_session
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SWITCH_NOT_FOUND');
  END IF;

  IF v_intent.expires_at <= now() THEN
    UPDATE public.mfa_switch_intents SET status = 'expired' WHERE id = v_intent.id;
    RETURN jsonb_build_object('ok', false, 'error', 'SWITCH_EXPIRED');
  END IF;

  IF v_intent.status <> 'pending_stepup' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SWITCH_STATE_INVALID');
  END IF;

  SELECT p.mfa_method INTO v_method
  FROM public.profiles p
  WHERE p.user_id = v_uid
  FOR UPDATE;

  IF v_method IS DISTINCT FROM v_intent.from_method THEN
    UPDATE public.mfa_switch_intents SET status = 'cancelled' WHERE id = v_intent.id;
    RETURN jsonb_build_object('ok', false, 'error', 'MFA_METHOD_CHANGED');
  END IF;

  IF v_intent.from_method = 'totp' THEN
    SELECT max(greatest(c.created_at, c.updated_at))
    INTO v_proof_time
    FROM auth.mfa_amr_claims c
    WHERE c.session_id = v_session
      AND c.authentication_method = 'totp'
      AND greatest(c.created_at, c.updated_at) >= v_intent.created_at
      AND greatest(c.created_at, c.updated_at) <= clock_timestamp();
  ELSE
    SELECT max(g.issued_at)
    INTO v_proof_time
    FROM public.custom_mfa_grants g
    WHERE g.user_id = v_uid
      AND g.session_id = v_session
      AND g.grant_type = 'login_mfa'
      AND g.factor_type = 'sms'
      AND g.revoked_at IS NULL
      AND g.expires_at > clock_timestamp()
      AND g.issued_at >= v_intent.created_at
      AND g.issued_at <= clock_timestamp();
  END IF;

  IF v_proof_time IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CURRENT_FACTOR_PROOF_REQUIRED');
  END IF;

  UPDATE public.mfa_switch_intents
  SET status = 'pending_enrollment',
      current_method_verified_at = v_proof_time
  WHERE id = v_intent.id;

  INSERT INTO public.security_audit_events(
    user_id, actor_user_id, target_user_id,
    event_type, event_category, severity,
    session_id, result, metadata
  ) VALUES (
    v_uid, v_uid, v_uid,
    'mfa_method_switch_current_verified', 'mfa', 'info',
    v_session, 'success',
    jsonb_build_object(
      'from_method', v_intent.from_method,
      'to_method', v_intent.to_method,
      'intent_id', v_intent.id::text
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'intent_id', v_intent.id,
    'from_method', v_intent.from_method,
    'to_method', v_intent.to_method,
    'current_method_verified_at', v_proof_time
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_mfa_method_switch_current(p_intent_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.confirm_mfa_method_switch_current_impl($1);
$function$;

REVOKE ALL ON FUNCTION public.confirm_mfa_method_switch_current(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_mfa_method_switch_current(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_mfa_method_switch_current(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.confirm_mfa_method_switch_current_impl(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.activate_canonical_totp_mfa_impl()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_session_ok boolean := false;
  v_method text;
  v_intent public.mfa_switch_intents%ROWTYPE;
  v_totp_proof_time timestamptz;
BEGIN
  IF v_uid IS NULL OR COALESCE(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEP_UP_REQUIRED');
  END IF;

  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END;

  SELECT EXISTS(
    SELECT 1
    FROM auth.sessions a
    WHERE a.id = v_session_id
      AND a.user_id = v_uid
      AND (a.not_after IS NULL OR a.not_after > now())
      AND a.aal::text = 'aal2'
  ) INTO v_session_ok;

  IF NOT v_session_ok OR NOT EXISTS(
    SELECT 1
    FROM auth.mfa_factors f
    WHERE f.user_id = v_uid
      AND f.factor_type = 'totp'
      AND f.status = 'verified'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOTP_NOT_VERIFIED');
  END IF;

  SELECT max(greatest(c.created_at, c.updated_at))
  INTO v_totp_proof_time
  FROM auth.mfa_amr_claims c
  WHERE c.session_id = v_session_id
    AND c.authentication_method = 'totp'
    AND greatest(c.created_at, c.updated_at) <= clock_timestamp();

  SELECT p.mfa_method INTO v_method
  FROM public.profiles p
  WHERE p.user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  IF v_method = 'totp' THEN
    RETURN jsonb_build_object('ok', true, 'already_active', true, 'mfa_method', 'totp');
  END IF;

  IF v_method = 'sms' THEN
    SELECT * INTO v_intent
    FROM public.mfa_switch_intents i
    WHERE i.user_id = v_uid
      AND i.session_id = v_session_id
      AND i.from_method = 'sms'
      AND i.to_method = 'totp'
      AND i.status = 'pending_enrollment'
      AND i.expires_at > now()
    ORDER BY i.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MFA_SWITCH_REQUIRED');
    END IF;

    IF v_intent.current_method_verified_at IS NULL
       OR v_totp_proof_time IS NULL
       OR v_totp_proof_time < v_intent.current_method_verified_at
    THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TARGET_FACTOR_PROOF_REQUIRED');
    END IF;
  ELSIF v_method IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MFA_METHOD_INVALID');
  END IF;

  PERFORM set_config('app.mfa_method_write', 'true', true);
  UPDATE public.profiles
  SET mfa_method = 'totp', updated_at = now()
  WHERE user_id = v_uid;
  PERFORM set_config('app.mfa_method_write', 'false', true);

  IF v_method = 'sms' THEN
    UPDATE public.mfa_switch_intents
    SET status = 'completed', completed_at = now()
    WHERE id = v_intent.id;

    UPDATE public.custom_mfa_grants
    SET revoked_at = now()
    WHERE user_id = v_uid
      AND factor_type = 'sms'
      AND grant_type = 'login_mfa'
      AND revoked_at IS NULL;

    INSERT INTO public.security_audit_events(
      user_id, actor_user_id, target_user_id,
      event_type, event_category, severity,
      session_id, result, metadata
    ) VALUES (
      v_uid, v_uid, v_uid,
      'mfa_method_switched', 'mfa', 'warning',
      v_session_id, 'success',
      jsonb_build_object('from_method', 'sms', 'to_method', 'totp', 'intent_id', v_intent.id::text)
    );
  ELSE
    INSERT INTO public.security_audit_events(
      user_id, actor_user_id, target_user_id,
      event_type, event_category, severity,
      session_id, result, metadata
    ) VALUES (
      v_uid, v_uid, v_uid,
      'mfa_method_selected', 'mfa', 'info',
      v_session_id, 'success',
      jsonb_build_object('mfa_method', 'totp')
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'mfa_method', 'totp');
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.mfa_method_write', 'false', true);
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_sms_mfa_challenge_v3(
  p_user_id uuid,
  p_session_id uuid,
  p_challenge_id uuid,
  p_otp_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v public.custom_mfa_challenges%ROWTYPE;
  v_expiry timestamptz;
  v_method text;
  v_intent public.mfa_switch_intents%ROWTYPE;
  v_switching boolean := false;
BEGIN
  SELECT * INTO v
  FROM public.custom_mfa_challenges
  WHERE id = p_challenge_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND
     OR v.session_id <> p_session_id
     OR v.factor_type <> 'sms'
     OR v.status <> 'pending'
     OR v.expires_at <= now()
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
  END IF;

  SELECT p.mfa_method INTO v_method
  FROM public.profiles p
  WHERE p.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  IF v.challenge_purpose = 'enrollment' AND v_method IS NOT NULL THEN
    SELECT * INTO v_intent
    FROM public.mfa_switch_intents i
    WHERE i.user_id = p_user_id
      AND i.session_id = p_session_id
      AND i.from_method = v_method
      AND i.to_method = 'sms'
      AND i.status = 'pending_enrollment'
      AND i.current_method_verified_at IS NOT NULL
      AND i.expires_at > now()
    ORDER BY i.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MFA_SWITCH_REQUIRED');
    END IF;
    v_switching := true;
  END IF;

  IF v.otp_hash <> p_otp_hash THEN
    UPDATE public.custom_mfa_challenges
    SET attempt_count = attempt_count + 1,
        status = CASE
          WHEN attempt_count + 1 >= max_attempts THEN 'max_attempts'
          ELSE status
        END
    WHERE id = v.id;
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  END IF;

  IF v.challenge_purpose = 'enrollment' THEN
    SELECT CASE
      WHEN a.not_after IS NULL THEN s.absolute_expiry_at
      ELSE LEAST(a.not_after, s.absolute_expiry_at)
    END
    INTO v_expiry
    FROM auth.sessions a
    JOIN public.session_security_state s
      ON s.session_id = a.id
     AND s.user_id = a.user_id
    WHERE a.id = p_session_id
      AND a.user_id = p_user_id
      AND (a.not_after IS NULL OR a.not_after > now())
      AND s.revoked_at IS NULL
      AND s.idle_expiry_at > now()
      AND s.absolute_expiry_at > now();

    IF v_expiry IS NULL OR v_expiry <= now() THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
    END IF;
  END IF;

  UPDATE public.custom_mfa_challenges
  SET status = 'consumed', consumed_at = now()
  WHERE id = v.id;

  IF v.challenge_purpose = 'enrollment' THEN
    UPDATE public.custom_mfa_factors
    SET factor_status = 'active', updated_at = now()
    WHERE id = v.factor_id
      AND user_id = p_user_id
      AND factor_status = 'pending';

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'FACTOR_INVALID');
    END IF;

    PERFORM set_config('app.mfa_method_write', 'true', true);
    UPDATE public.profiles
    SET mfa_method = 'sms', updated_at = now()
    WHERE user_id = p_user_id
      AND (
        (NOT v_switching AND mfa_method IS NULL)
        OR (v_switching AND mfa_method = v_method)
      );
    PERFORM set_config('app.mfa_method_write', 'false', true);

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MFA_METHOD_CHANGED');
    END IF;

    IF v_switching THEN
      UPDATE public.mfa_switch_intents
      SET status = 'completed', completed_at = now()
      WHERE id = v_intent.id;
    END IF;

    UPDATE public.custom_mfa_grants
    SET revoked_at = now()
    WHERE user_id = p_user_id
      AND session_id = p_session_id
      AND grant_type = 'login_mfa'
      AND factor_type = 'sms'
      AND revoked_at IS NULL;

    INSERT INTO public.custom_mfa_grants(
      user_id, session_id, grant_type, factor_type,
      issued_at, expires_at, metadata
    ) VALUES (
      p_user_id, p_session_id, 'login_mfa', 'sms',
      now(), v_expiry,
      jsonb_build_object(
        'challenge_id', p_challenge_id,
        'source', CASE WHEN v_switching THEN 'mfa_method_switch' ELSE 'mfa_enrollment' END
      )
    );

    INSERT INTO public.security_audit_events(
      user_id, actor_user_id, target_user_id,
      event_type, event_category, severity,
      session_id, result, metadata
    ) VALUES (
      p_user_id, p_user_id, p_user_id,
      CASE WHEN v_switching THEN 'mfa_method_switched' ELSE 'mfa_method_selected' END,
      'mfa',
      CASE WHEN v_switching THEN 'warning' ELSE 'info' END,
      p_session_id,
      'success',
      CASE
        WHEN v_switching THEN jsonb_build_object(
          'from_method', v_method,
          'to_method', 'sms',
          'intent_id', v_intent.id::text
        )
        ELSE jsonb_build_object('mfa_method', 'sms')
      END
    );

    RETURN jsonb_build_object(
      'ok', true,
      'enrolled', true,
      'switched', v_switching,
      'mfa_method', 'sms',
      'expires_at', v_expiry
    );
  END IF;

  SELECT CASE
    WHEN a.not_after IS NULL THEN s.absolute_expiry_at
    ELSE LEAST(a.not_after, s.absolute_expiry_at)
  END
  INTO v_expiry
  FROM auth.sessions a
  JOIN public.session_security_state s
    ON s.session_id = a.id
   AND s.user_id = a.user_id
  WHERE a.id = p_session_id
    AND a.user_id = p_user_id
    AND (a.not_after IS NULL OR a.not_after > now())
    AND s.revoked_at IS NULL
    AND s.idle_expiry_at > now()
    AND s.absolute_expiry_at > now();

  IF v_expiry IS NULL OR v_expiry <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  UPDATE public.custom_mfa_grants
  SET revoked_at = now()
  WHERE user_id = p_user_id
    AND session_id = p_session_id
    AND grant_type = 'login_mfa'
    AND factor_type = 'sms'
    AND revoked_at IS NULL;

  INSERT INTO public.custom_mfa_grants(
    user_id, session_id, grant_type, factor_type,
    issued_at, expires_at, metadata
  ) VALUES (
    p_user_id, p_session_id, 'login_mfa', 'sms',
    now(), v_expiry, jsonb_build_object('challenge_id', p_challenge_id)
  );

  RETURN jsonb_build_object('ok', true, 'expires_at', v_expiry);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.mfa_method_write', 'false', true);
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_sms_mfa_challenge_v3(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_sms_mfa_challenge_v3(uuid, uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.consume_sms_mfa_challenge_v3(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_sms_mfa_challenge_v3(uuid, uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
