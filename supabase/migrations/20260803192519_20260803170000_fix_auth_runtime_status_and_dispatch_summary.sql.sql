-- ════════════════════════════════════════════════════════════════════════════
-- Fix get_auth_runtime_status:
--   1. Read allowed_origins into a TEXT variable (not int)
--   2. Count origins with proper logic (no text-to-int cast)
--   3. Login SMS template from sms_templates (same table as auth-send-sms-hook)
--   4. Bale templates stay in notification_templates
--   5. search_path = '' (not 'public')
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_auth_runtime_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;

  v_hook_secret_confirmed boolean := false;
  v_rate_limit_pepper_configured boolean := false;
  v_allowed_origins_set boolean := false;
  v_origins_text text := '';
  v_origins_arr text[];
  v_origins_count int := 0;

  v_provider_id text;
  v_provider_selected boolean := false;
  v_provider_active boolean := false;

  v_login_template_ready boolean := false;
  v_login_template_body text;
  v_recovery_template_ready boolean := false;
  v_recovery_template_body text;

  v_bale_active boolean := false;
  v_bale_bot_token_set boolean := false;
  v_bale_bot_username_set boolean := false;
  v_bale_login_template_ready boolean := false;
  v_bale_login_template_body text;
  v_bale_recovery_template_ready boolean := false;
  v_bale_recovery_template_body text;

  v_bale_mapping_count int := 0;
  v_bale_auth_codes_enabled_count int := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT COALESCE(is_admin, false), COALESCE(is_active, false)
  INTO v_is_admin, v_rate_limit_pepper_configured
  FROM public.profiles
  WHERE user_id = v_uid
  LIMIT 1;

  IF NOT FOUND OR NOT v_rate_limit_pepper_configured THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- Hook secret: operator_confirmed flag in system_config
  SELECT (value = 'true') INTO v_hook_secret_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed'
  LIMIT 1;
  v_hook_secret_confirmed := COALESCE(v_hook_secret_confirmed, false);

  -- Rate limit pepper: admin-configured flag (env var not readable from SQL)
  SELECT (value = 'true') INTO v_rate_limit_pepper_configured
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_rate_limit_pepper_configured'
  LIMIT 1;
  v_rate_limit_pepper_configured := COALESCE(v_rate_limit_pepper_configured, false);

  -- Allowed origins: read as TEXT, split, count
  SELECT value INTO v_origins_text
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_allowed_origins'
  LIMIT 1;

  v_origins_text := COALESCE(v_origins_text, '');
  IF btrim(v_origins_text) <> '' THEN
    v_origins_arr := string_to_array(v_origins_text, ',');
    -- Count non-empty trimmed elements
    SELECT COUNT(*) INTO v_origins_count
    FROM unnest(v_origins_arr) AS elem
    WHERE btrim(elem) <> '';
  ELSE
    v_origins_count := 0;
  END IF;
  v_allowed_origins_set := v_origins_count > 0;

  -- Provider
  SELECT value INTO v_provider_id
  FROM public.system_config
  WHERE section = 'sms' AND key = 'phone_login_sms_provider_id'
  LIMIT 1;
  v_provider_selected := v_provider_id IS NOT NULL AND btrim(v_provider_id) <> '';

  IF v_provider_selected THEN
    BEGIN
      SELECT COALESCE(is_active, false) INTO v_provider_active
      FROM public.sms_providers
      WHERE id = v_provider_id::uuid
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_provider_active := false;
    END;
  END IF;

  -- Login SMS template: from sms_templates (same table auth-send-sms-hook uses)
  BEGIN
    SELECT body INTO v_login_template_body
    FROM public.sms_templates
    WHERE category = 'auth' AND event_type = 'login_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;
    v_login_template_ready := v_login_template_body IS NOT NULL
      AND v_login_template_body LIKE '%{{otp}}%';
  EXCEPTION WHEN OTHERS THEN
    v_login_template_ready := false;
  END;

  -- Recovery SMS template: from sms_templates
  BEGIN
    SELECT body INTO v_recovery_template_body
    FROM public.sms_templates
    WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;
    v_recovery_template_ready := v_recovery_template_body IS NOT NULL
      AND v_recovery_template_body LIKE '%{{otp}}%';
  EXCEPTION WHEN OTHERS THEN
    v_recovery_template_ready := false;
  END;

  -- Bale channel
  SELECT COALESCE(is_active, false),
         CASE WHEN btrim(COALESCE(bot_token, '')) <> '' THEN true ELSE false END,
         CASE WHEN btrim(COALESCE(bot_username, '')) <> '' THEN true ELSE false END
  INTO v_bale_active, v_bale_bot_token_set, v_bale_bot_username_set
  FROM public.social_channel_configs
  WHERE channel = 'bale'
  LIMIT 1;

  IF NOT FOUND THEN
    v_bale_active := false;
    v_bale_bot_token_set := false;
    v_bale_bot_username_set := false;
  END IF;

  -- Bale login template: from notification_templates
  BEGIN
    SELECT body INTO v_bale_login_template_body
    FROM public.notification_templates
    WHERE category = 'auth' AND event_type = 'login_otp_bale' AND audience = 'all' AND is_active = true
    LIMIT 1;
    v_bale_login_template_ready := v_bale_login_template_body IS NOT NULL
      AND v_bale_login_template_body LIKE '%{{otp}}%';
  EXCEPTION WHEN OTHERS THEN
    v_bale_login_template_ready := false;
  END;

  -- Bale recovery template: from notification_templates
  BEGIN
    SELECT body INTO v_bale_recovery_template_body
    FROM public.notification_templates
    WHERE category = 'auth' AND event_type = 'password_reset_otp_bale' AND audience = 'all' AND is_active = true
    LIMIT 1;
    v_bale_recovery_template_ready := v_bale_recovery_template_body IS NOT NULL
      AND v_bale_recovery_template_body LIKE '%{{otp}}%';
  EXCEPTION WHEN OTHERS THEN
    v_bale_recovery_template_ready := false;
  END;

  -- Bale mapping stats
  SELECT COUNT(*), COUNT(*) FILTER (WHERE COALESCE(auth_codes_enabled, false) = true)
  INTO v_bale_mapping_count, v_bale_auth_codes_enabled_count
  FROM public.user_bale_mapping;

  RETURN jsonb_build_object(
    'ok', true,
    'hook_secret_confirmed', v_hook_secret_confirmed,
    'rate_limit_pepper_configured', v_rate_limit_pepper_configured,
    'allowed_origins_set', v_allowed_origins_set,
    'allowed_origins_count', v_origins_count,
    'provider_selected', v_provider_selected,
    'provider_active', v_provider_active,
    'login_template_ready', v_login_template_ready,
    'recovery_template_ready', v_recovery_template_ready,
    'bale_channel_active', v_bale_active,
    'bale_bot_token_set', v_bale_bot_token_set,
    'bale_bot_username_set', v_bale_bot_username_set,
    'bale_login_template_ready', v_bale_login_template_ready,
    'bale_recovery_template_ready', v_bale_recovery_template_ready,
    'bale_mapping_count', v_bale_mapping_count,
    'bale_auth_codes_enabled_count', v_bale_auth_codes_enabled_count
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_auth_runtime_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_auth_runtime_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_auth_runtime_status() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Fix get_bale_auth_dispatch_summary:
--   1. Last dispatch read WITHOUT error_code condition (separate query)
--   2. Last error read in separate query
--   3. search_path = '' (not 'public')
--   4. No OTP, phone, chat_id, or raw error text returned
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_bale_auth_dispatch_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_active boolean := false;
  v_count_sent int := 0;
  v_count_failed int := 0;
  v_count_skipped int := 0;
  v_count_processing int := 0;
  v_total int := 0;
  v_last_error_code text;
  v_last_error_purpose text;
  v_last_error_at timestamptz;
  v_last_dispatch_status text;
  v_last_dispatch_purpose text;
  v_last_dispatch_at timestamptz;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT COALESCE(is_admin, false), COALESCE(is_active, false)
  INTO v_is_admin, v_is_active
  FROM public.profiles
  WHERE user_id = v_uid
  LIMIT 1;

  IF NOT FOUND OR NOT v_is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- Status counts
  SELECT
    COUNT(*) FILTER (WHERE status = 'sent'),
    COUNT(*) FILTER (WHERE status = 'failed'),
    COUNT(*) FILTER (WHERE status = 'skipped'),
    COUNT(*) FILTER (WHERE status = 'processing'),
    COUNT(*)
  INTO v_count_sent, v_count_failed, v_count_skipped, v_count_processing, v_total
  FROM public.bale_auth_code_dispatches;

  -- Last dispatch (no error_code condition) — separate query
  SELECT status, purpose, completed_at
  INTO v_last_dispatch_status, v_last_dispatch_purpose, v_last_dispatch_at
  FROM public.bale_auth_code_dispatches
  ORDER BY completed_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  -- Last error — separate query, only error_code (no raw body)
  SELECT error_code, purpose, completed_at
  INTO v_last_error_code, v_last_error_purpose, v_last_error_at
  FROM public.bale_auth_code_dispatches
  WHERE error_code IS NOT NULL
  ORDER BY completed_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'counts', jsonb_build_object(
      'sent', v_count_sent,
      'failed', v_count_failed,
      'skipped', v_count_skipped,
      'processing', v_count_processing,
      'total', v_total
    ),
    'last_dispatch_status', v_last_dispatch_status,
    'last_dispatch_purpose', v_last_dispatch_purpose,
    'last_dispatch_at', v_last_dispatch_at,
    'last_error_code', v_last_error_code,
    'last_error_purpose', v_last_error_purpose,
    'last_error_at', v_last_error_at
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_bale_auth_dispatch_summary() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_bale_auth_dispatch_summary() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_bale_auth_dispatch_summary() TO authenticated;
