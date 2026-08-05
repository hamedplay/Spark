/*\n# Phase 4 — Registration Runtime Security Hardening\n\n## Summary\nFixes runtime, security and atomicity blockers in the public registration flow:\n- Replaces get_public_auth_config with runtime-safe version (Blocker 1)\n- Adds check_public_registration_identifiers_available RPC (Blocker 5)\n- Adds consume_public_registration_rate_limit_v2 atomic RPC (Blocker 6)\n- Adds challenge V2 RPCs with claim ownership (Blocker 8)\n- Adds account_status/is_active consistency constraint NOT VALID (Blocker 15)\n- Revokes old RPCs from service_role (no longer used by edge functions)\n\n## Safety\n- No prior migration modified\n- No data deleted/reset/truncated\n- No MFA policy changed\n- No production data changed\n- Old functions kept but execute revoked from service_role\n*/\n\n-- ════════════════════════════════════════════════════════════\n-- Blocker 1: Replace get_public_auth_config — runtime-safe\n-- ════════════════════════════════════════════════════════════\n\nDROP FUNCTION IF EXISTS public.get_public_auth_config()
\n\nCREATE FUNCTION public.get_public_auth_config()\nRETURNS TABLE(\n  phone_login_enabled boolean,\n  provider_ready boolean,\n  operator_confirmed boolean,\n  e2e_verified boolean,\n  phone_login_test_mode boolean,\n  phone_login_test_ready boolean,\n  phone_login_ready boolean,\n  otp_ttl_operator_confirmed boolean,\n  phone_password_recovery_enabled boolean,\n  phone_password_recovery_test_mode boolean,\n  phone_password_recovery_test_ready boolean,\n  phone_password_recovery_ready boolean,\n  recovery_template_ready boolean,\n  recovery_secret_confirmed boolean,\n  recovery_ttl_valid boolean,\n  recovery_ttl_seconds integer,\n  phone_password_recovery_e2e_verified boolean,\n  phone_login_canonical_enabled boolean,\n  phone_login_canonical_ready boolean,\n  phone_password_recovery_canonical_enabled boolean,\n  phone_password_recovery_canonical_ready boolean,\n  registration_enabled boolean,\n  registration_ready boolean,\n  registration_requires_admin_approval boolean,\n  require_profile_completion boolean,\n  registration_otp_ttl_seconds integer,\n  registration_otp_resend_seconds integer\n)\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO 'public'\nAS $function$\nDECLARE\n  v_login_canonical boolean := false
\n  v_recovery_canonical boolean := false
\n  v_provider_id text := NULL
\n  v_provider_active boolean := false
\n  v_provider_ready boolean := false
\n  v_origins_text text := ''
\n  v_origins_count int := 0
\n  v_origins_set boolean := false
\n  v_login_template_ready boolean := false
\n  v_login_template_body text := ''
\n  v_recovery_template_ready boolean := false
\n  v_recovery_template_body text := ''
\n  v_recovery_ttl_text text := ''
\n  v_recovery_ttl_seconds int := 0
\n  v_recovery_ttl_valid boolean := false
\n  v_recovery_secret_proxy boolean := false
\n  v_registration_enabled boolean := false
\n  v_registration_requires_admin_approval boolean := false
\n  v_require_profile_completion boolean := false
\n  v_reg_otp_ttl_text text := ''
\n  v_reg_otp_ttl_seconds int := 300
\n  v_reg_otp_resend_text text := ''
\n  v_reg_otp_resend_seconds int := 60
\n  v_reg_secret_proxy boolean := false
\n  v_reg_template_ready boolean := false
\n  v_reg_template_body text := ''
\n  v_reg_provider_id text := NULL
\n  v_reg_provider_active boolean := false
\n  v_registration_ready boolean := false
\nBEGIN\n  SELECT (value = 'true') INTO v_login_canonical\n  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_canonical_enabled' LIMIT 1
\n  v_login_canonical := COALESCE(v_login_canonical, false)
\n\n  SELECT (value = 'true') INTO v_recovery_canonical\n  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_canonical_enabled' LIMIT 1
\n  v_recovery_canonical := COALESCE(v_recovery_canonical, false)
\n\n  SELECT value INTO v_provider_id\n  FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1
\n\n  IF v_provider_id IS NOT NULL THEN\n    BEGIN\n      SELECT COALESCE(is_active, false) INTO v_provider_active\n      FROM public.sms_providers WHERE id = v_provider_id::uuid LIMIT 1
\n    EXCEPTION WHEN OTHERS THEN v_provider_active := false
 END
\n  END IF
\n  v_provider_ready := v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false)
\n\n  SELECT value INTO v_origins_text\n  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_allowed_origins' LIMIT 1
\n  v_origins_text := COALESCE(v_origins_text, '')
\n  IF btrim(v_origins_text) <> '' THEN\n    SELECT COUNT(*) INTO v_origins_count\n    FROM unnest(string_to_array(v_origins_text, ',')) AS elem\n    WHERE btrim(elem) <> ''
\n  ELSE\n    v_origins_count := 0
\n  END IF
\n  v_origins_set := v_origins_count > 0
\n\n  BEGIN\n    SELECT body INTO v_login_template_body\n    FROM public.sms_templates\n    WHERE category = 'auth' AND event_type = 'login_otp' AND audience = 'all' AND is_active = true\n    LIMIT 1
\n    v_login_template_ready := v_login_template_body IS NOT NULL AND v_login_template_body LIKE '%{{otp}}%'
\n  EXCEPTION WHEN OTHERS THEN v_login_template_ready := false
 END
\n\n  BEGIN\n    SELECT body INTO v_recovery_template_body\n    FROM public.notification_templates\n    WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true\n    LIMIT 1
\n    v_recovery_template_ready := v_recovery_template_body IS NOT NULL AND v_recovery_template_body LIKE '%{{otp}}%'
\n  EXCEPTION WHEN OTHERS THEN v_recovery_template_ready := false
 END
\n\n  SELECT value INTO v_recovery_ttl_text\n  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1
\n  BEGIN\n    v_recovery_ttl_seconds := COALESCE(v_recovery_ttl_text::integer, 600)
\n  EXCEPTION WHEN OTHERS THEN v_recovery_ttl_seconds := 600
 END
\n  v_recovery_ttl_valid := v_recovery_ttl_seconds >= 60 AND v_recovery_ttl_seconds <= 86400
\n\n  SELECT (value = 'true') INTO v_recovery_secret_proxy\n  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_configured' LIMIT 1
\n  v_recovery_secret_proxy := COALESCE(v_recovery_secret_proxy, false)
\n\n  -- Registration settings: use explicit boolean columns, NOT (value = 'true')\n  SELECT\n    COALESCE(registration_enabled, false),\n    COALESCE(registration_requires_admin_approval, false),\n    COALESCE(require_profile_completion, false)\n  INTO\n    v_registration_enabled,\n    v_registration_requires_admin_approval,\n    v_require_profile_completion\n  FROM public.auth_security_settings\n  WHERE id = 1\n  LIMIT 1
\n\n  SELECT value INTO v_reg_otp_ttl_text\n  FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_ttl_seconds' LIMIT 1
\n  BEGIN\n    v_reg_otp_ttl_seconds := COALESCE(v_reg_otp_ttl_text::integer, 300)
\n  EXCEPTION WHEN OTHERS THEN v_reg_otp_ttl_seconds := 300
 END
\n\n  SELECT value INTO v_reg_otp_resend_text\n  FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_resend_seconds' LIMIT 1
\n  BEGIN\n    v_reg_otp_resend_seconds := COALESCE(v_reg_otp_resend_text::integer, 60)
\n  EXCEPTION WHEN OTHERS THEN v_reg_otp_resend_seconds := 60
 END
\n\n  SELECT (value = 'true') INTO v_reg_secret_proxy\n  FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_secret_configured' LIMIT 1
\n  v_reg_secret_proxy := COALESCE(v_reg_secret_proxy, false)
\n\n  -- Registration uses same provider as phone login\n  v_reg_provider_id := v_provider_id
\n  v_reg_provider_active := v_provider_active
\n\n  BEGIN\n    SELECT body INTO v_reg_template_body\n    FROM public.sms_templates\n    WHERE category = 'auth' AND event_type = 'registration_phone_otp' AND audience = 'all' AND is_active = true\n    LIMIT 1
\n    v_reg_template_ready := v_reg_template_body IS NOT NULL AND v_reg_template_body LIKE '%{{otp}}%'
\n  EXCEPTION WHEN OTHERS THEN v_reg_template_ready := false
 END
\n\n  v_registration_ready :=\n    v_registration_enabled\n    AND v_reg_provider_id IS NOT NULL\n    AND v_reg_provider_active\n    AND v_reg_template_ready\n    AND v_origins_set\n    AND v_reg_secret_proxy\n    AND v_reg_otp_ttl_seconds >= 60 AND v_reg_otp_ttl_seconds <= 86400\n    AND v_reg_otp_resend_seconds >= 30 AND v_reg_otp_resend_seconds <= 3600
\n\n  RETURN QUERY SELECT\n    false,\n    v_provider_ready,\n    false, false, false, false,\n    v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set,\n    false,\n    false, false, false,\n    v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,\n    v_recovery_template_ready,\n    v_recovery_secret_proxy,\n    v_recovery_ttl_valid,\n    v_recovery_ttl_seconds,\n    false,\n    v_login_canonical,\n    v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set,\n    v_recovery_canonical,\n    v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,\n    v_registration_enabled,\n    v_registration_ready,\n    v_registration_requires_admin_approval,\n    v_require_profile_completion,\n    v_reg_otp_ttl_seconds,\n    v_reg_otp_resend_seconds
\nEND
\n$function$
\n\nALTER FUNCTION public.get_public_auth_config() OWNER TO postgres
\nREVOKE EXECUTE ON FUNCTION public.get_public_auth_config() FROM PUBLIC
\nGRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon
\nGRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO authenticated
\n\n-- ════════════════════════════════════════════════════════════\n-- Blocker 5: check_public_registration_identifiers_available\n-- ════════════════════════════════════════════════════════════\n\nCREATE OR REPLACE FUNCTION public.check_public_registration_identifiers_available(\n  p_normalized_username text,\n  p_normalized_email text,\n  p_normalized_phone text\n)\nRETURNS boolean\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_username_exists boolean := false
\n  v_email_profile_exists boolean := false
\n  v_email_auth_exists boolean := false
\n  v_phone_profile_exists boolean := false
\n  v_phone_auth_exists boolean := false
\nBEGIN\n  IF p_normalized_username IS NOT NULL AND btrim(p_normalized_username) <> '' THEN\n    SELECT EXISTS(\n      SELECT 1 FROM public.profiles\n      WHERE normalized_username = p_normalized_username\n    ) INTO v_username_exists
\n  END IF
\n\n  IF p_normalized_email IS NOT NULL AND btrim(p_normalized_email) <> '' THEN\n    SELECT EXISTS(\n      SELECT 1 FROM public.profiles\n      WHERE normalized_email = p_normalized_email\n    ) INTO v_email_profile_exists
\n\n    SELECT EXISTS(\n      SELECT 1 FROM auth.users\n      WHERE lower(email) = lower(p_normalized_email)\n    ) INTO v_email_auth_exists
\n  END IF
\n\n  IF p_normalized_phone IS NOT NULL AND btrim(p_normalized_phone) <> '' THEN\n    SELECT EXISTS(\n      SELECT 1 FROM public.profiles\n      WHERE normalized_phone = p_normalized_phone\n    ) INTO v_phone_profile_exists
\n\n    SELECT EXISTS(\n      SELECT 1 FROM auth.users\n      WHERE phone = p_normalized_phone\n    ) INTO v_phone_auth_exists
\n  END IF
\n\n  RETURN NOT (\n    v_username_exists\n    OR v_email_profile_exists\n    OR v_email_auth_exists\n    OR v_phone_profile_exists\n    OR v_phone_auth_exists\n  )
\nEND
\n$function$
\n\nALTER FUNCTION public.check_public_registration_identifiers_available(text, text, text) OWNER TO postgres
\nREVOKE EXECUTE ON FUNCTION public.check_public_registration_identifiers_available(text, text, text) FROM PUBLIC
\nREVOKE EXECUTE ON FUNCTION public.check_public_registration_identifiers_available(text, text, text) FROM anon
\nREVOKE EXECUTE ON FUNCTION public.check_public_registration_identifiers_available(text, text, text) FROM authenticated
\nGRANT EXECUTE ON FUNCTION public.check_public_registration_identifiers_available(text, text, text) TO service_role
\n\n-- ════════════════════════════════════════════════════════════\n-- Blocker 6: consume_public_registration_rate_limit_v2\n-- ════════════════════════════════════════════════════════════\n\nCREATE OR REPLACE FUNCTION public.consume_public_registration_rate_limit_v2(\n  p_identity_hash text,\n  p_phone_hash text,\n  p_ip_hash text,\n  p_purpose text,\n  p_identity_limit integer,\n  p_phone_limit integer,\n  p_ip_limit integer,\n  p_window_seconds integer\n)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_identity_count int := 0
\n  v_phone_count int := 0
\n  v_ip_count int := 0
\n  v_window_start timestamptz
\n  v_identity_key bigint
\n  v_phone_key bigint
\n  v_ip_key bigint
\n  v_retry_after int := 0
\n  v_identity_retry int := 0
\n  v_phone_retry int := 0
\n  v_ip_retry int := 0
\nBEGIN\n  IF p_purpose NOT IN ('registration_request', 'registration_verify') THEN\n    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', 0, 'error', 'INVALID_PURPOSE')
\n  END IF
\n\n  IF p_identity_limit IS NULL OR p_identity_limit < 1 OR p_identity_limit > 1000 THEN\n    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', 0, 'error', 'INVALID_IDENTITY_LIMIT')
\n  END IF
\n\n  IF p_phone_limit IS NULL OR p_phone_limit < 1 OR p_phone_limit > 1000 THEN\n    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', 0, 'error', 'INVALID_PHONE_LIMIT')
\n  END IF
\n\n  IF p_ip_limit IS NULL OR p_ip_limit < 1 OR p_ip_limit > 1000 THEN\n    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', 0, 'error', 'INVALID_IP_LIMIT')
\n  END IF
\n\n  IF p_window_seconds IS NULL OR p_window_seconds < 30 OR p_window_seconds > 86400 THEN\n    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', 0, 'error', 'INVALID_WINDOW')
\n  END IF
\n\n  v_window_start := clock_timestamp() - (p_window_seconds || ' seconds')::interval
\n\n  v_identity_key := ('x' || md5(COALESCE(p_identity_hash, '')))::bit(64)::bigint
\n  v_phone_key := ('x' || md5(COALESCE(p_phone_hash, '')))::bit(64)::bigint
\n  v_ip_key := ('x' || md5(COALESCE(p_ip_hash, '')))::bit(64)::bigint
\n\n  PERFORM pg_advisory_xact_lock(v_identity_key)
\n  PERFORM pg_advisory_xact_lock(v_phone_key)
\n  PERFORM pg_advisory_xact_lock(v_ip_key)
\n\n  IF p_identity_hash IS NOT NULL THEN\n    SELECT count(*) INTO v_identity_count\n    FROM public.public_registration_rate_limit\n    WHERE identity_hash = p_identity_hash\n      AND purpose = p_purpose\n      AND created_at > v_window_start
\n  END IF
\n\n  IF p_phone_hash IS NOT NULL THEN\n    SELECT count(*) INTO v_phone_count\n    FROM public.public_registration_rate_limit\n    WHERE phone_hash = p_phone_hash\n      AND purpose = p_purpose\n      AND created_at > v_window_start
\n  END IF
\n\n  IF p_ip_hash IS NOT NULL THEN\n    SELECT count(*) INTO v_ip_count\n    FROM public.public_registration_rate_limit\n    WHERE ip_hash = p_ip_hash\n      AND purpose = p_purpose\n      AND created_at > v_window_start
\n  END IF
\n\n  IF v_identity_count >= p_identity_limit THEN\n    v_identity_retry := p_window_seconds
\n  END IF
\n  IF v_phone_count >= p_phone_limit THEN\n    v_phone_retry := p_window_seconds
\n  END IF
\n  IF v_ip_count >= p_ip_limit THEN\n    v_ip_retry := p_window_seconds
\n  END IF
\n\n  v_retry_after := GREATEST(v_identity_retry, v_phone_retry, v_ip_retry)
\n\n  IF v_retry_after > 0 THEN\n    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', v_retry_after)
\n  END IF
\n\n  INSERT INTO public.public_registration_rate_limit (identity_hash, phone_hash, ip_hash, purpose)\n  VALUES (p_identity_hash, p_phone_hash, p_ip_hash, p_purpose)
\n\n  RETURN jsonb_build_object('allowed', true, 'retry_after_seconds', 0)
\nEND
\n$function$
\n\nALTER FUNCTION public.consume_public_registration_rate_limit_v2(text, text, text, text, integer, integer, integer, integer) OWNER TO postgres
\nREVOKE EXECUTE ON FUNCTION public.consume_public_registration_rate_limit_v2(text, text, text, text, integer, integer, integer, integer) FROM PUBLIC
\nREVOKE EXECUTE ON FUNCTION public.consume_public_registration_rate_limit_v2(text, text, text, text, integer, integer, integer, integer) FROM anon
\nREVOKE EXECUTE ON FUNCTION public.consume_public_registration_rate_limit_v2(text, text, text, text, integer, integer, integer, integer) FROM authenticated
\nGRANT EXECUTE ON FUNCTION public.consume_public_registration_rate_limit_v2(text, text, text, text, integer, integer, integer, integer) TO service_role
\n\n-- Revoke old rate limit RPC from service_role\nREVOKE EXECUTE ON FUNCTION public.consume_public_registration_rate_limit(text, text, text, text) FROM service_role
\n\n-- ════════════════════════════════════════════════════════════\n-- Blocker 8: Challenge V2 RPCs with claim ownership\n-- ════════════════════════════════════════════════════════════\n\nCREATE OR REPLACE FUNCTION public.create_public_registration_challenge_v2(\n  p_challenge_id uuid,\n  p_identity_hash text,\n  p_email_hash text,\n  p_username_hash text,\n  p_phone_hash text,\n  p_otp_hash text,\n  p_expires_at timestamptz,\n  p_request_id uuid DEFAULT NULL\n)\nRETURNS uuid\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_identity_key bigint
\n  v_phone_key bigint
\nBEGIN\n  IF p_challenge_id IS NULL THEN\n    RETURN NULL
\n  END IF
\n\n  v_identity_key := ('x' || md5(COALESCE(p_identity_hash, '')))::bit(64)::bigint
\n  v_phone_key := ('x' || md5(COALESCE(p_phone_hash, '')))::bit(64)::bigint
\n\n  PERFORM pg_advisory_xact_lock(v_identity_key)
\n  PERFORM pg_advisory_xact_lock(v_phone_key)
\n\n  UPDATE public.public_registration_challenges\n  SET status = 'expired', updated_at = now()\n  WHERE (identity_hash = p_identity_hash OR phone_hash = p_phone_hash)\n    AND status = 'pending'\n    AND id <> p_challenge_id
\n\n  UPDATE public.public_registration_challenges\n  SET status = 'expired', updated_at = now()\n  WHERE (identity_hash = p_identity_hash OR phone_hash = p_phone_hash)\n    AND status = 'delivery_failed'\n    AND id <> p_challenge_id
\n\n  UPDATE public.public_registration_challenges\n  SET status = 'expired',\n      processing_claim_id = NULL,\n      processing_started_at = NULL,\n      processing_expires_at = NULL,\n      updated_at = now()\n  WHERE (identity_hash = p_identity_hash OR phone_hash = p_phone_hash)\n    AND status = 'processing'\n    AND processing_expires_at IS NOT NULL\n    AND processing_expires_at <= now()\n    AND id <> p_challenge_id
\n\n  INSERT INTO public.public_registration_challenges (\n    id, identity_hash, email_hash, username_hash, phone_hash, otp_hash,\n    expires_at, request_id\n  ) VALUES (\n    p_challenge_id, p_identity_hash, p_email_hash, p_username_hash, p_phone_hash, p_otp_hash,\n    p_expires_at, p_request_id\n  )
\n\n  RETURN p_challenge_id
\nEND
\n$function$
\n\nALTER FUNCTION public.create_public_registration_challenge_v2(uuid, text, text, text, text, text, timestamptz, uuid) OWNER TO postgres
\nREVOKE EXECUTE ON FUNCTION public.create_public_registration_challenge_v2(uuid, text, text, text, text, text, timestamptz, uuid) FROM PUBLIC
\nREVOKE EXECUTE ON FUNCTION public.create_public_registration_challenge_v2(uuid, text, text, text, text, text, timestamptz, uuid) FROM anon
\nREVOKE EXECUTE ON FUNCTION public.create_public_registration_challenge_v2(uuid, text, text, text, text, text, timestamptz, uuid) FROM authenticated
\nGRANT EXECUTE ON FUNCTION public.create_public_registration_challenge_v2(uuid, text, text, text, text, text, timestamptz, uuid) TO service_role
\n\nCREATE OR REPLACE FUNCTION public.claim_public_registration_challenge_v2(\n  p_challenge_id uuid,\n  p_identity_hash text,\n  p_otp_hash text,\n  p_claim_id uuid\n)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_challenge record
\n  v_new_attempt integer
\nBEGIN\n  IF p_challenge_id IS NULL OR p_identity_hash IS NULL OR p_otp_hash IS NULL OR p_claim_id IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS')
\n  END IF
\n\n  SELECT * INTO v_challenge\n  FROM public.public_registration_challenges\n  WHERE id = p_challenge_id\n  FOR UPDATE
\n\n  IF NOT FOUND THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_NOT_FOUND')
\n  END IF
\n\n  IF v_challenge.status = 'consumed' THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_CONSUMED', 'created_user_id', v_challenge.created_user_id)
\n  END IF
\n\n  IF v_challenge.status = 'locked' OR (v_challenge.locked_until IS NOT NULL AND v_challenge.locked_until > now()) THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_LOCKED')
\n  END IF
\n\n  IF v_challenge.status = 'expired' OR v_challenge.expires_at <= now() THEN\n    UPDATE public.public_registration_challenges SET status = 'expired', updated_at = now()\n    WHERE id = p_challenge_id
\n    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_EXPIRED')
\n  END IF
\n\n  IF v_challenge.status = 'delivery_failed' THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_EXPIRED')
\n  END IF
\n\n  IF v_challenge.status = 'processing'\n     AND v_challenge.processing_expires_at IS NOT NULL\n     AND v_challenge.processing_expires_at > now() THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'ACTIVE_PROCESSING')
\n  END IF
\n\n  IF v_challenge.status = 'processing'\n     AND v_challenge.processing_expires_at IS NOT NULL\n     AND v_challenge.processing_expires_at <= now() THEN\n    UPDATE public.public_registration_challenges\n    SET status = 'pending',\n        processing_claim_id = NULL,\n        processing_started_at = NULL,\n        processing_expires_at = NULL,\n        updated_at = now()\n    WHERE id = p_challenge_id
\n\n    SELECT * INTO v_challenge\n    FROM public.public_registration_challenges\n    WHERE id = p_challenge_id\n    FOR UPDATE
\n  END IF
\n\n  IF v_challenge.identity_hash != p_identity_hash THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_EXPIRED')
\n  END IF
\n\n  IF v_challenge.otp_hash != p_otp_hash THEN\n    v_new_attempt := COALESCE(v_challenge.attempt_count, 0) + 1
\n\n    IF v_new_attempt >= v_challenge.max_attempts THEN\n      UPDATE public.public_registration_challenges\n      SET status = 'locked',\n          locked_until = now() + interval '30 minutes',\n          attempt_count = v_new_attempt,\n          updated_at = now()\n      WHERE id = p_challenge_id
\n      RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_LOCKED')
\n    END IF
\n\n    UPDATE public.public_registration_challenges\n    SET attempt_count = v_new_attempt,\n        updated_at = now()\n    WHERE id = p_challenge_id
\n\n    RETURN jsonb_build_object('ok', false, 'error', 'OTP_INVALID')
\n  END IF
\n\n  UPDATE public.public_registration_challenges\n  SET status = 'processing',\n      processing_claim_id = p_claim_id,\n      processing_started_at = now(),\n      processing_expires_at = now() + interval '5 minutes',\n      updated_at = now()\n  WHERE id = p_challenge_id\n    AND status = 'pending'
\n\n  IF NOT FOUND THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_EXPIRED')
\n  END IF
\n\n  RETURN jsonb_build_object('ok', true, 'claim_id', p_claim_id)
\nEND
\n$function$
\n\nALTER FUNCTION public.claim_public_registration_challenge_v2(uuid, text, text, uuid) OWNER TO postgres
\nREVOKE EXECUTE ON FUNCTION public.claim_public_registration_challenge_v2(uuid, text, text, uuid) FROM PUBLIC
\nREVOKE EXECUTE ON FUNCTION public.claim_public_registration_challenge_v2(uuid, text, text, uuid) FROM anon
\nREVOKE EXECUTE ON FUNCTION public.claim_public_registration_challenge_v2(uuid, text, text, uuid) FROM authenticated
\nGRANT EXECUTE ON FUNCTION public.claim_public_registration_challenge_v2(uuid, text, text, uuid) TO service_role
\n\nCREATE OR REPLACE FUNCTION public.release_public_registration_claim_v2(\n  p_challenge_id uuid,\n  p_claim_id uuid\n)\nRETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nBEGIN\n  UPDATE public.public_registration_challenges\n  SET status = 'pending',\n      processing_claim_id = NULL,\n      processing_started_at = NULL,\n      processing_expires_at = NULL,\n      updated_at = now()\n  WHERE id = p_challenge_id\n    AND status = 'processing'\n    AND processing_claim_id = p_claim_id
\nEND
\n$function$
\n\nALTER FUNCTION public.release_public_registration_claim_v2(uuid, uuid) OWNER TO postgres
\nREVOKE EXECUTE ON FUNCTION public.release_public_registration_claim_v2(uuid, uuid) FROM PUBLIC
\nREVOKE EXECUTE ON FUNCTION public.release_public_registration_claim_v2(uuid, uuid) FROM anon
\nREVOKE EXECUTE ON FUNCTION public.release_public_registration_claim_v2(uuid, uuid) FROM authenticated
\nGRANT EXECUTE ON FUNCTION public.release_public_registration_claim_v2(uuid, uuid) TO service_role
\n\nCREATE OR REPLACE FUNCTION public.mark_registration_delivery_failed_v2(\n  p_challenge_id uuid\n)\nRETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nBEGIN\n  UPDATE public.public_registration_challenges\n  SET status = 'delivery_failed',\n      updated_at = now()\n  WHERE id = p_challenge_id\n    AND status = 'pending'
\nEND
\n$function$
\n\nALTER FUNCTION public.mark_registration_delivery_failed_v2(uuid) OWNER TO postgres
\nREVOKE EXECUTE ON FUNCTION public.mark_registration_delivery_failed_v2(uuid) FROM PUBLIC
\nREVOKE EXECUTE ON FUNCTION public.mark_registration_delivery_failed_v2(uuid) FROM anon
\nREVOKE EXECUTE ON FUNCTION public.mark_registration_delivery_failed_v2(uuid) FROM authenticated
\nGRANT EXECUTE ON FUNCTION public.mark_registration_delivery_failed_v2(uuid) TO service_role
\n\n-- Revoke old challenge RPCs from service_role\nREVOKE EXECUTE ON FUNCTION public.create_public_registration_challenge(text, text, text, text, text, timestamptz, uuid) FROM service_role
\nREVOKE EXECUTE ON FUNCTION public.claim_public_registration_challenge(uuid, text, text) FROM service_role
\nREVOKE EXECUTE ON FUNCTION public.release_public_registration_claim(uuid) FROM service_role
\nREVOKE EXECUTE ON FUNCTION public.mark_registration_delivery_failed(uuid) FROM service_role
\nREVOKE EXECUTE ON FUNCTION public.finalize_public_registration_challenge(uuid, uuid) FROM service_role
\n\n-- ════════════════════════════════════════════════════════════\n-- Blocker 15: account_status / is_active consistency constraint\n-- NOT VALID — enforces new writes, does not validate existing data\n-- ════════════════════════════════════════════════════════════\n\nDO $$\nBEGIN\n  IF NOT EXISTS (\n    SELECT 1 FROM pg_constraint\n    WHERE conname = 'profiles_account_status_active_consistency'\n    AND conrelid = 'public.profiles'::regclass\n  ) THEN\n    ALTER TABLE public.profiles\n    ADD CONSTRAINT profiles_account_status_active_consistency\n    CHECK (\n      (\n        account_status = 'ACTIVE'\n        AND is_active IS TRUE\n      )\n      OR\n      (\n        account_status <> 'ACTIVE'\n        AND is_active IS FALSE\n      )\n    ) NOT VALID
\n  END IF
\nEND $$
\n