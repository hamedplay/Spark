-- Fix ambiguous column reference in get_public_auth_config\nCREATE OR REPLACE FUNCTION public.get_public_auth_config()\nRETURNS TABLE(\n  phone_login_enabled boolean,\n  provider_ready boolean,\n  operator_confirmed boolean,\n  e2e_verified boolean,\n  phone_login_test_mode boolean,\n  phone_login_test_ready boolean,\n  phone_login_ready boolean,\n  otp_ttl_operator_confirmed boolean,\n  phone_password_recovery_enabled boolean,\n  phone_password_recovery_test_mode boolean,\n  phone_password_recovery_test_ready boolean,\n  phone_password_recovery_ready boolean,\n  recovery_template_ready boolean,\n  recovery_secret_confirmed boolean,\n  recovery_ttl_valid boolean,\n  recovery_ttl_seconds integer,\n  phone_password_recovery_e2e_verified boolean,\n  phone_login_canonical_enabled boolean,\n  phone_login_canonical_ready boolean,\n  phone_password_recovery_canonical_enabled boolean,\n  phone_password_recovery_canonical_ready boolean,\n  registration_enabled boolean,\n  registration_ready boolean,\n  registration_requires_admin_approval boolean,\n  require_profile_completion boolean,\n  registration_otp_ttl_seconds integer,\n  registration_otp_resend_seconds integer\n)\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO 'public'\nAS $function$\nDECLARE\n  v_login_canonical boolean := false
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
\n\n  -- FIX: use table-qualified column names to avoid ambiguity with PL/pgSQL variables\n  SELECT\n    COALESCE(s.registration_enabled, false),\n    COALESCE(s.registration_requires_admin_approval, false),\n    COALESCE(s.require_profile_completion, false)\n  INTO\n    v_registration_enabled,\n    v_registration_requires_admin_approval,\n    v_require_profile_completion\n  FROM public.auth_security_settings s\n  WHERE s.id = 1\n  LIMIT 1
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
\n\n  BEGIN\n    SELECT body INTO v_reg_template_body\n    FROM public.sms_templates\n    WHERE category = 'auth' AND event_type = 'registration_phone_otp' AND audience = 'all' AND is_active = true\n    LIMIT 1
\n    v_reg_template_ready := v_reg_template_body IS NOT NULL AND v_reg_template_body LIKE '%{{otp}}%'
\n  EXCEPTION WHEN OTHERS THEN v_reg_template_ready := false
 END
\n\n  v_registration_ready := v_registration_enabled\n    AND v_provider_ready\n    AND v_reg_template_ready\n    AND v_origins_set\n    AND v_reg_secret_proxy\n    AND v_reg_otp_ttl_seconds >= 60 AND v_reg_otp_ttl_seconds <= 86400\n    AND v_reg_otp_resend_seconds >= 30 AND v_reg_otp_resend_seconds <= 3600
\n\n  RETURN QUERY SELECT\n    false,\n    v_provider_ready,\n    false, false, false, false,\n    v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set,\n    false,\n    false, false, false,\n    v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,\n    v_recovery_template_ready,\n    v_recovery_secret_proxy,\n    v_recovery_ttl_valid,\n    v_recovery_ttl_seconds,\n    false,\n    v_login_canonical,\n    v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set,\n    v_recovery_canonical,\n    v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,\n    v_registration_enabled,\n    v_registration_ready,\n    v_registration_requires_admin_approval,\n    v_require_profile_completion,\n    v_reg_otp_ttl_seconds,\n    v_reg_otp_resend_seconds
\nEND
\n$function$
\n\nALTER FUNCTION public.get_public_auth_config() OWNER TO postgres
\n