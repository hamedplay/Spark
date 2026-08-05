-- Fix ambiguous column reference in get_public_auth_config
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


  v_registration_enabled boolean := false;


  v_registration_requires_admin_approval boolean := false;


  v_require_profile_completion boolean := false;


  v_reg_otp_ttl_text text := '';


  v_reg_otp_ttl_seconds int := 300;


  v_reg_otp_resend_text text := '';


  v_reg_otp_resend_seconds int := 60;


  v_reg_secret_proxy boolean := false;


  v_reg_template_ready boolean := false;


  v_reg_template_body text := '';


  v_registration_ready boolean := false;


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


    EXCEPTION WHEN OTHERS THEN v_provider_active := false;

 END;


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


  EXCEPTION WHEN OTHERS THEN v_login_template_ready := false;

 END;



  BEGIN
    SELECT body INTO v_recovery_template_body
    FROM public.notification_templates
    WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;


    v_recovery_template_ready := v_recovery_template_body IS NOT NULL AND v_recovery_template_body LIKE '%{{otp}}%';


  EXCEPTION WHEN OTHERS THEN v_recovery_template_ready := false;

 END;



  SELECT value INTO v_recovery_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;


  BEGIN
    v_recovery_ttl_seconds := COALESCE(v_recovery_ttl_text::integer, 600);


  EXCEPTION WHEN OTHERS THEN v_recovery_ttl_seconds := 600;

 END;


  v_recovery_ttl_valid := v_recovery_ttl_seconds >= 60 AND v_recovery_ttl_seconds <= 86400;



  SELECT (value = 'true') INTO v_recovery_secret_proxy
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_configured' LIMIT 1;


  v_recovery_secret_proxy := COALESCE(v_recovery_secret_proxy, false);



  -- FIX: use table-qualified column names to avoid ambiguity with PL/pgSQL variables
  SELECT
    COALESCE(s.registration_enabled, false),
    COALESCE(s.registration_requires_admin_approval, false),
    COALESCE(s.require_profile_completion, false)
  INTO
    v_registration_enabled,
    v_registration_requires_admin_approval,
    v_require_profile_completion
  FROM public.auth_security_settings s
  WHERE s.id = 1
  LIMIT 1;



  SELECT value INTO v_reg_otp_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_ttl_seconds' LIMIT 1;


  BEGIN
    v_reg_otp_ttl_seconds := COALESCE(v_reg_otp_ttl_text::integer, 300);


  EXCEPTION WHEN OTHERS THEN v_reg_otp_ttl_seconds := 300;

 END;



  SELECT value INTO v_reg_otp_resend_text
  FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_resend_seconds' LIMIT 1;


  BEGIN
    v_reg_otp_resend_seconds := COALESCE(v_reg_otp_resend_text::integer, 60);


  EXCEPTION WHEN OTHERS THEN v_reg_otp_resend_seconds := 60;

 END;



  SELECT (value = 'true') INTO v_reg_secret_proxy
  FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_secret_configured' LIMIT 1;


  v_reg_secret_proxy := COALESCE(v_reg_secret_proxy, false);



  BEGIN
    SELECT body INTO v_reg_template_body
    FROM public.sms_templates
    WHERE category = 'auth' AND event_type = 'registration_phone_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;


    v_reg_template_ready := v_reg_template_body IS NOT NULL AND v_reg_template_body LIKE '%{{otp}}%';


  EXCEPTION WHEN OTHERS THEN v_reg_template_ready := false;

 END;



  v_registration_ready := v_registration_enabled
    AND v_provider_ready
    AND v_reg_template_ready
    AND v_origins_set
    AND v_reg_secret_proxy
    AND v_reg_otp_ttl_seconds >= 60 AND v_reg_otp_ttl_seconds <= 86400
    AND v_reg_otp_resend_seconds >= 30 AND v_reg_otp_resend_seconds <= 3600;



  RETURN QUERY SELECT
    false,
    v_provider_ready,
    false, false, false, false,
    v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set,
    false,
    false, false, false,
    v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,
    v_recovery_template_ready,
    v_recovery_secret_proxy,
    v_recovery_ttl_valid,
    v_recovery_ttl_seconds,
    false,
    v_login_canonical,
    v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set,
    v_recovery_canonical,
    v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,
    v_registration_enabled,
    v_registration_ready,
    v_registration_requires_admin_approval,
    v_require_profile_completion,
    v_reg_otp_ttl_seconds,
    v_reg_otp_resend_seconds;


END;


$function$;



ALTER FUNCTION public.get_public_auth_config() OWNER TO postgres;


;
