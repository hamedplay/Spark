-- Phase 5E-A: Phone OTP Login Configuration and Safety Gate
-- Adds independent OTP login settings, login SMS template validation,
-- and gates public/admin readiness on backend_ready=false until backend is complete.

-- ============================================================================
-- 1. System config keys
-- ============================================================================

DO $$
DECLARE
  v_existing text;
BEGIN
  -- phone_otp_login_backend_ready
  SELECT value INTO v_existing
  FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_backend_ready' LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF v_existing <> 'false' THEN
      RAISE EXCEPTION 'phone_otp_login_backend_ready exists with value %, expected false', v_existing;
    END IF;
  ELSE
    INSERT INTO public.system_config (section, key, value, value_type)
    VALUES ('security', 'phone_otp_login_backend_ready', 'false', 'boolean');
  END IF;

  -- phone_otp_login_ttl_seconds
  v_existing := NULL;
  SELECT value INTO v_existing
  FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_ttl_seconds' LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF v_existing <> '120' THEN
      RAISE EXCEPTION 'phone_otp_login_ttl_seconds exists with value %, expected 120', v_existing;
    END IF;
  ELSE
    INSERT INTO public.system_config (section, key, value, value_type)
    VALUES ('security', 'phone_otp_login_ttl_seconds', '120', 'number');
  END IF;

  -- phone_otp_login_resend_seconds
  v_existing := NULL;
  SELECT value INTO v_existing
  FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_resend_seconds' LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF v_existing <> '60' THEN
      RAISE EXCEPTION 'phone_otp_login_resend_seconds exists with value %, expected 60', v_existing;
    END IF;
  ELSE
    INSERT INTO public.system_config (section, key, value, value_type)
    VALUES ('security', 'phone_otp_login_resend_seconds', '60', 'number');
  END IF;

  -- phone_otp_login_max_attempts
  v_existing := NULL;
  SELECT value INTO v_existing
  FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_max_attempts' LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF v_existing <> '5' THEN
      RAISE EXCEPTION 'phone_otp_login_max_attempts exists with value %, expected 5', v_existing;
    END IF;
  ELSE
    INSERT INTO public.system_config (section, key, value, value_type)
    VALUES ('security', 'phone_otp_login_max_attempts', '5', 'number');
  END IF;
END $$;

-- ============================================================================
-- 2. SMS template for login_otp
-- ============================================================================

DO $$
DECLARE
  v_body text;
  v_is_active boolean;
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.sms_templates
  WHERE category = 'auth' AND event_type = 'login_otp' AND audience = 'all';

  IF v_count > 0 THEN
    SELECT body, is_active INTO v_body, v_is_active
    FROM public.sms_templates
    WHERE category = 'auth' AND event_type = 'login_otp' AND audience = 'all'
    LIMIT 1;

    IF v_is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'login_otp template exists but is not active';
    END IF;

    IF v_body IS NULL OR v_body NOT LIKE '%{{otp}}%' THEN
      RAISE EXCEPTION 'login_otp template body must contain {{otp}}';
    END IF;
  ELSE
    INSERT INTO public.sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
    VALUES (
      'auth',
      'login_otp',
      'all',
      '',
      'کد ورود شما به سامانه: {{otp}}',
      ARRAY['otp']::text[],
      true
    );
  END IF;
END $$;

-- ============================================================================
-- 3. Fix get_public_auth_config — gate readiness on backend_ready
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_public_auth_config()
RETURNS TABLE(
  phone_login_enabled boolean,
  provider_ready boolean,
  operator_confirmed boolean,
  e2e_verified boolean,
  phone_login_test_mode boolean,
  phone_login_test_ready boolean,
  phone_login_ready boolean,
  otp_ttl_operator_confirmed boolean,
  phone_password_recovery_enabled boolean,
  phone_password_recovery_test_mode boolean,
  phone_password_recovery_test_ready boolean,
  phone_password_recovery_ready boolean,
  recovery_template_ready boolean,
  recovery_secret_confirmed boolean,
  recovery_ttl_valid boolean,
  recovery_ttl_seconds integer,
  phone_password_recovery_e2e_verified boolean,
  phone_login_canonical_enabled boolean,
  phone_login_canonical_ready boolean,
  phone_password_recovery_canonical_enabled boolean,
  phone_password_recovery_canonical_ready boolean,
  registration_enabled boolean,
  registration_ready boolean,
  registration_requires_admin_approval boolean,
  require_profile_completion boolean,
  registration_otp_ttl_seconds integer,
  registration_otp_resend_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_login_canonical boolean := false;
v_recovery_canonical boolean := false;
v_provider_id text := NULL;
v_provider_active boolean := false;
v_provider_ready boolean := false;
v_origins_text text := '';
v_origins_count int := 0;
v_origins_set boolean := false;
v_login_template_ready boolean := false;
v_login_template_body text := '';
v_recovery_template_ready boolean := false;
v_recovery_template_body text := '';
v_recovery_ttl_text text := '';
v_recovery_ttl_seconds int := 0;
v_recovery_ttl_valid boolean := false;
v_recovery_secret_proxy boolean := false;
v_reg_enabled boolean := false;
v_reg_admin_approval boolean := false;
v_reg_profile_completion boolean := false;
v_reg_otp_ttl_text text := '';
v_reg_otp_ttl_seconds int := 300;
v_reg_otp_resend_text text := '';
v_reg_otp_resend_seconds int := 60;
v_reg_secret_proxy boolean := false;
v_reg_template_ready boolean := false;
v_reg_template_body text := '';
v_reg_provider_id text := NULL;
v_reg_provider_active boolean := false;
v_registration_ready boolean := false;
v_otp_login_backend_ready_text text := '';
v_otp_login_backend_ready boolean := false;
v_otp_login_ttl_text text := '';
v_otp_login_ttl_seconds int := 120;
v_otp_login_ttl_valid boolean := false;
v_otp_login_resend_text text := '';
v_otp_login_resend_seconds int := 60;
v_otp_login_resend_valid boolean := false;
v_otp_login_max_attempts_text text := '';
v_otp_login_max_attempts int := 5;
v_otp_login_max_attempts_valid boolean := false;
v_otp_login_gate boolean := false;
BEGIN
SELECT (value = 'true') INTO v_login_canonical
FROM public.system_config WHERE section = 'security' AND key = 'phone_login_canonical_enabled' LIMIT 1;
v_login_canonical := COALESCE(v_login_canonical, false);

SELECT (value = 'true') INTO v_recovery_canonical
FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_canonical_enabled' LIMIT 1;
v_recovery_canonical := COALESCE(v_recovery_canonical, false);

SELECT value INTO v_provider_id
FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;

IF v_provider_id IS NOT NULL THEN
BEGIN
SELECT COALESCE(is_active, false) INTO v_provider_active
FROM public.sms_providers WHERE id = v_provider_id::uuid LIMIT 1;
EXCEPTION WHEN OTHERS THEN v_provider_active := false; END;
END IF;
v_provider_ready := v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);

SELECT value INTO v_origins_text
FROM public.system_config WHERE section = 'security' AND key = 'phone_login_allowed_origins' LIMIT 1;
v_origins_text := COALESCE(v_origins_text, '');
IF btrim(v_origins_text) <> '' THEN
SELECT COUNT(*) INTO v_origins_count
FROM unnest(string_to_array(v_origins_text, ',')) AS elem
WHERE btrim(elem) <> '';
ELSE
v_origins_count := 0;
END IF;
v_origins_set := v_origins_count > 0;

BEGIN
SELECT body INTO v_login_template_body
FROM public.sms_templates
WHERE category = 'auth' AND event_type = 'login_otp' AND audience = 'all' AND is_active = true
LIMIT 1;
v_login_template_ready := v_login_template_body IS NOT NULL AND v_login_template_body LIKE '%{{otp}}%';
EXCEPTION WHEN OTHERS THEN v_login_template_ready := false; END;

BEGIN
SELECT body INTO v_recovery_template_body
FROM public.notification_templates
WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
LIMIT 1;
v_recovery_template_ready := v_recovery_template_body IS NOT NULL AND v_recovery_template_body LIKE '%{{otp}}%';
EXCEPTION WHEN OTHERS THEN v_recovery_template_ready := false; END;

SELECT value INTO v_recovery_ttl_text
FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;
BEGIN
v_recovery_ttl_seconds := COALESCE(v_recovery_ttl_text::integer, 600);
EXCEPTION WHEN OTHERS THEN v_recovery_ttl_seconds := 600; END;
v_recovery_ttl_valid := v_recovery_ttl_seconds >= 60 AND v_recovery_ttl_seconds <= 86400;

SELECT (value = 'true') INTO v_recovery_secret_proxy
FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_configured' LIMIT 1;
v_recovery_secret_proxy := COALESCE(v_recovery_secret_proxy, false);

-- Registration settings
SELECT
COALESCE(s.registration_enabled, false),
COALESCE(s.registration_requires_admin_approval, false),
COALESCE(s.require_profile_completion, false)
INTO
v_reg_enabled,
v_reg_admin_approval,
v_reg_profile_completion
FROM public.auth_security_settings s
WHERE s.id = 1
LIMIT 1;

SELECT value INTO v_reg_otp_ttl_text
FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_ttl_seconds' LIMIT 1;
BEGIN
v_reg_otp_ttl_seconds := COALESCE(v_reg_otp_ttl_text::integer, 300);
EXCEPTION WHEN OTHERS THEN v_reg_otp_ttl_seconds := 300; END;

SELECT value INTO v_reg_otp_resend_text
FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_resend_seconds' LIMIT 1;
BEGIN
v_reg_otp_resend_seconds := COALESCE(v_reg_otp_resend_text::integer, 60);
EXCEPTION WHEN OTHERS THEN v_reg_otp_resend_seconds := 60; END;

SELECT (value = 'true') INTO v_reg_secret_proxy
FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_secret_configured' LIMIT 1;
v_reg_secret_proxy := COALESCE(v_reg_secret_proxy, false);

v_reg_provider_id := v_provider_id;
v_reg_provider_active := v_provider_active;

BEGIN
SELECT body INTO v_reg_template_body
FROM public.sms_templates
WHERE category = 'auth' AND event_type = 'registration_phone_otp' AND audience = 'all' AND is_active = true
LIMIT 1;
v_reg_template_ready := v_reg_template_body IS NOT NULL AND v_reg_template_body LIKE '%{{otp}}%';
EXCEPTION WHEN OTHERS THEN v_reg_template_ready := false; END;

v_registration_ready :=
v_reg_enabled
AND v_reg_provider_id IS NOT NULL
AND v_reg_provider_active
AND v_reg_template_ready
AND v_origins_set
AND v_reg_secret_proxy
AND v_reg_otp_ttl_seconds >= 60 AND v_reg_otp_ttl_seconds <= 86400
AND v_reg_otp_resend_seconds >= 30 AND v_reg_otp_resend_seconds <= 3600;

-- Phase 5E-A: Phone OTP login configuration gate
SELECT value INTO v_otp_login_backend_ready_text
FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_backend_ready' LIMIT 1;
v_otp_login_backend_ready := COALESCE(v_otp_login_backend_ready_text = 'true', false);

SELECT value INTO v_otp_login_ttl_text
FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_ttl_seconds' LIMIT 1;
BEGIN
v_otp_login_ttl_seconds := COALESCE(v_otp_login_ttl_text::integer, 120);
EXCEPTION WHEN OTHERS THEN v_otp_login_ttl_seconds := 120; END;
v_otp_login_ttl_valid := v_otp_login_ttl_seconds >= 60 AND v_otp_login_ttl_seconds <= 300;

SELECT value INTO v_otp_login_resend_text
FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_resend_seconds' LIMIT 1;
BEGIN
v_otp_login_resend_seconds := COALESCE(v_otp_login_resend_text::integer, 60);
EXCEPTION WHEN OTHERS THEN v_otp_login_resend_seconds := 60; END;
v_otp_login_resend_valid := v_otp_login_resend_seconds >= 30 AND v_otp_login_resend_seconds <= 300;

SELECT value INTO v_otp_login_max_attempts_text
FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_max_attempts' LIMIT 1;
BEGIN
v_otp_login_max_attempts := COALESCE(v_otp_login_max_attempts_text::integer, 5);
EXCEPTION WHEN OTHERS THEN v_otp_login_max_attempts := 5; END;
v_otp_login_max_attempts_valid := v_otp_login_max_attempts >= 3 AND v_otp_login_max_attempts <= 10;

v_otp_login_gate :=
v_otp_login_backend_ready
AND v_otp_login_ttl_valid
AND v_otp_login_resend_valid
AND v_otp_login_max_attempts_valid;

RETURN QUERY SELECT
false,
v_provider_ready,
false, false, false, false,
v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set AND v_otp_login_gate,
false,
false, false, false,
v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,
v_recovery_template_ready,
v_recovery_secret_proxy,
v_recovery_ttl_valid,
v_recovery_ttl_seconds,
false,
v_login_canonical,
v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set AND v_otp_login_gate,
v_recovery_canonical,
v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,
v_reg_enabled,
v_registration_ready,
v_reg_admin_approval,
v_reg_profile_completion,
v_reg_otp_ttl_seconds,
v_reg_otp_resend_seconds;
END;
$function$;

ALTER FUNCTION public.get_public_auth_config() OWNER TO postgres;

-- ============================================================================
-- 4. Fix get_phone_auth_admin_status — add login config fields and gate
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_phone_auth_admin_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_uid uuid := auth.uid();
v_is_admin boolean := false;
v_is_active boolean := false;
v_login_canonical boolean := false;
v_recovery_canonical boolean := false;
v_provider_id text;
v_provider_selected boolean := false;
v_provider_active boolean := false;
v_origins_text text := '';
v_origins_count int := 0;
v_origins_set boolean := false;
v_login_template_ready boolean := false;
v_login_template_body text;
v_recovery_template_ready boolean := false;
v_recovery_template_body text;
v_recovery_ttl_text text := '';
v_recovery_ttl_seconds int := 0;
v_recovery_ttl_valid boolean := false;
v_recovery_secret_proxy boolean := false;
v_sync_matched int := 0;
v_sync_auth_only int := 0;
v_sync_profile_only int := 0;
v_sync_mismatched int := 0;
v_sync_duplicates int := 0;
v_last_dispatch jsonb := NULL;
v_otp_login_backend_ready_text text := '';
v_otp_login_backend_ready boolean := false;
v_otp_login_ttl_text text := '';
v_otp_login_ttl_seconds int := 120;
v_otp_login_ttl_valid boolean := false;
v_otp_login_resend_text text := '';
v_otp_login_resend_seconds int := 60;
v_otp_login_resend_valid boolean := false;
v_otp_login_max_attempts_text text := '';
v_otp_login_max_attempts int := 5;
v_otp_login_max_attempts_valid boolean := false;
BEGIN
IF v_uid IS NULL THEN
RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
END IF;

SELECT COALESCE(is_admin, false), COALESCE(is_active, false)
INTO v_is_admin, v_is_active
FROM public.profiles WHERE user_id = v_uid LIMIT 1;

IF NOT FOUND OR NOT v_is_active OR NOT v_is_admin THEN
RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
END IF;

SELECT (value = 'true') INTO v_login_canonical
FROM public.system_config WHERE section = 'security' AND key = 'phone_login_canonical_enabled' LIMIT 1;
v_login_canonical := COALESCE(v_login_canonical, false);

SELECT (value = 'true') INTO v_recovery_canonical
FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_canonical_enabled' LIMIT 1;
v_recovery_canonical := COALESCE(v_recovery_canonical, false);

SELECT value INTO v_provider_id
FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;
v_provider_selected := v_provider_id IS NOT NULL AND btrim(v_provider_id) <> '';

IF v_provider_selected THEN
BEGIN
SELECT COALESCE(is_active, false) INTO v_provider_active
FROM public.sms_providers WHERE id = v_provider_id::uuid LIMIT 1;
EXCEPTION WHEN OTHERS THEN v_provider_active := false; END;
END IF;

SELECT value INTO v_origins_text
FROM public.system_config WHERE section = 'security' AND key = 'phone_login_allowed_origins' LIMIT 1;
v_origins_text := COALESCE(v_origins_text, '');
IF btrim(v_origins_text) <> '' THEN
SELECT COUNT(*) INTO v_origins_count
FROM unnest(string_to_array(v_origins_text, ',')) AS elem
WHERE btrim(elem) <> '';
ELSE
v_origins_count := 0;
END IF;
v_origins_set := v_origins_count > 0;

BEGIN
SELECT body INTO v_login_template_body
FROM public.sms_templates
WHERE category = 'auth' AND event_type = 'login_otp' AND audience = 'all' AND is_active = true
LIMIT 1;
v_login_template_ready := v_login_template_body IS NOT NULL AND v_login_template_body LIKE '%{{otp}}%';
EXCEPTION WHEN OTHERS THEN v_login_template_ready := false; END;

BEGIN
SELECT body INTO v_recovery_template_body
FROM public.notification_templates
WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
LIMIT 1;
v_recovery_template_ready := v_recovery_template_body IS NOT NULL AND v_recovery_template_body LIKE '%{{otp}}%';
EXCEPTION WHEN OTHERS THEN v_recovery_template_ready := false; END;

SELECT value INTO v_recovery_ttl_text
FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;
BEGIN
v_recovery_ttl_seconds := COALESCE(v_recovery_ttl_text::integer, 600);
EXCEPTION WHEN OTHERS THEN v_recovery_ttl_seconds := 600; END;
v_recovery_ttl_valid := v_recovery_ttl_seconds >= 60 AND v_recovery_ttl_seconds <= 86400;

SELECT (value = 'true') INTO v_recovery_secret_proxy
FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_configured' LIMIT 1;
v_recovery_secret_proxy := COALESCE(v_recovery_secret_proxy, false);

BEGIN
SELECT COUNT(*) INTO v_sync_matched
FROM public.profiles p
INNER JOIN auth.users u ON u.id = p.user_id
WHERE p.phone IS NOT NULL AND btrim(p.phone) <> ''
AND u.phone IS NOT NULL AND btrim(u.phone) <> ''
AND public.normalize_iran_phone(p.phone) = public.normalize_iran_phone(u.phone);
EXCEPTION WHEN OTHERS THEN v_sync_matched := 0; END;

BEGIN
SELECT COUNT(*) INTO v_sync_auth_only
FROM public.profiles p
INNER JOIN auth.users u ON u.id = p.user_id
WHERE (p.phone IS NULL OR btrim(p.phone) = '') AND u.phone IS NOT NULL AND btrim(u.phone) <> '';
EXCEPTION WHEN OTHERS THEN v_sync_auth_only := 0; END;

BEGIN
SELECT COUNT(*) INTO v_sync_profile_only
FROM public.profiles p
INNER JOIN auth.users u ON u.id = p.user_id
WHERE p.phone IS NOT NULL AND btrim(p.phone) <> '' AND (u.phone IS NULL OR btrim(u.phone) = '');
EXCEPTION WHEN OTHERS THEN v_sync_profile_only := 0; END;

BEGIN
SELECT COUNT(*) INTO v_sync_mismatched
FROM public.profiles p
INNER JOIN auth.users u ON u.id = p.user_id
WHERE p.phone IS NOT NULL AND btrim(p.phone) <> ''
AND u.phone IS NOT NULL AND btrim(u.phone) <> ''
AND public.normalize_iran_phone(p.phone) <> public.normalize_iran_phone(u.phone);
EXCEPTION WHEN OTHERS THEN v_sync_mismatched := 0; END;

BEGIN
WITH normalized_phones AS (
SELECT public.normalize_iran_phone(p.phone) AS nphone
FROM public.profiles p
WHERE p.phone IS NOT NULL AND btrim(p.phone) <> ''
)
SELECT COUNT(*) INTO v_sync_duplicates
FROM (
SELECT nphone, COUNT(*) AS cnt
FROM normalized_phones
WHERE nphone <> ''
GROUP BY nphone
HAVING COUNT(*) > 1
) dup;
EXCEPTION WHEN OTHERS THEN v_sync_duplicates := 0; END;

BEGIN
SELECT jsonb_build_object(
'status', sms_dispatch_logs.status,
'created_at', sms_dispatch_logs.created_at,
'event_type', sms_dispatch_logs.event_type
) INTO v_last_dispatch
FROM public.sms_dispatch_logs
WHERE category = 'auth'
ORDER BY created_at DESC
LIMIT 1;
EXCEPTION WHEN OTHERS THEN v_last_dispatch := NULL; END;

-- Phase 5E-A: Phone OTP login configuration
SELECT value INTO v_otp_login_backend_ready_text
FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_backend_ready' LIMIT 1;
v_otp_login_backend_ready := COALESCE(v_otp_login_backend_ready_text = 'true', false);

SELECT value INTO v_otp_login_ttl_text
FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_ttl_seconds' LIMIT 1;
BEGIN
v_otp_login_ttl_seconds := COALESCE(v_otp_login_ttl_text::integer, 120);
EXCEPTION WHEN OTHERS THEN v_otp_login_ttl_seconds := 120; END;
v_otp_login_ttl_valid := v_otp_login_ttl_seconds >= 60 AND v_otp_login_ttl_seconds <= 300;

SELECT value INTO v_otp_login_resend_text
FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_resend_seconds' LIMIT 1;
BEGIN
v_otp_login_resend_seconds := COALESCE(v_otp_login_resend_text::integer, 60);
EXCEPTION WHEN OTHERS THEN v_otp_login_resend_seconds := 60; END;
v_otp_login_resend_valid := v_otp_login_resend_seconds >= 30 AND v_otp_login_resend_seconds <= 300;

SELECT value INTO v_otp_login_max_attempts_text
FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_max_attempts' LIMIT 1;
BEGIN
v_otp_login_max_attempts := COALESCE(v_otp_login_max_attempts_text::integer, 5);
EXCEPTION WHEN OTHERS THEN v_otp_login_max_attempts := 5; END;
v_otp_login_max_attempts_valid := v_otp_login_max_attempts >= 3 AND v_otp_login_max_attempts <= 10;

RETURN jsonb_build_object(
'ok', true,
'phone_login_canonical_enabled', v_login_canonical,
'phone_login_canonical_ready', v_login_canonical AND v_provider_active AND v_login_template_ready AND v_origins_set AND v_otp_login_backend_ready,
'phone_password_recovery_canonical_enabled', v_recovery_canonical,
'phone_password_recovery_canonical_ready', v_recovery_canonical AND v_provider_active AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,
'provider_selected', v_provider_selected,
'provider_active', v_provider_active,
'login_template_ready', v_login_template_ready,
'recovery_template_ready', v_recovery_template_ready,
'recovery_ttl_valid', v_recovery_ttl_valid,
'recovery_ttl_seconds', v_recovery_ttl_seconds,
'recovery_secret_configured', v_recovery_secret_proxy,
'origins_set', v_origins_set,
'origins_count', v_origins_count,
'sync_matched', v_sync_matched,
'sync_auth_only', v_sync_auth_only,
'sync_profile_only', v_sync_profile_only,
'sync_mismatched', v_sync_mismatched,
'sync_duplicates', v_sync_duplicates,
'last_dispatch', v_last_dispatch,
'login_backend_ready', v_otp_login_backend_ready,
'login_ttl_seconds', v_otp_login_ttl_seconds,
'login_ttl_valid', v_otp_login_ttl_valid,
'login_resend_seconds', v_otp_login_resend_seconds,
'login_resend_valid', v_otp_login_resend_valid,
'login_max_attempts', v_otp_login_max_attempts,
'login_max_attempts_valid', v_otp_login_max_attempts_valid
);
END;
$function$;

ALTER FUNCTION public.get_phone_auth_admin_status() OWNER TO postgres;
