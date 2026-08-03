-- ════════════════════════════════════════════════════════════════════════════
-- 1. Harden set_bale_auth_otp_config: validate prerequisites BEFORE enabling
--    Fail-Closed: if channel inactive, bot_token/username missing, or template
--    lacks {{otp}}, return error. Do NOT enable.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_bale_auth_otp_config(p_key text, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile record;
  v_allowed_keys text[] := ARRAY['phone_login_bale_otp_enabled', 'phone_password_recovery_bale_otp_enabled'];
  v_new_val text;
  v_updated_count int;
  v_bale_active boolean := false;
  v_bot_token text := '';
  v_bot_username text := '';
  v_template_event_type text;
  v_template_body text;
  v_template_active boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT is_active, is_admin INTO v_profile
  FROM profiles
  WHERE user_id = v_uid;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_INACTIVE');
  END IF;

  IF v_profile.is_admin IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  IF NOT (p_key = ANY(v_allowed_keys)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_KEY');
  END IF;

  -- ── If DISABLING: no prerequisite check needed, just disable ──────────────
  IF p_enabled = false THEN
    v_new_val := 'false';
    UPDATE system_config
    SET value = v_new_val, updated_at = now()
    WHERE section = 'security' AND key = p_key;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count < 1 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CONFIG_NOT_FOUND');
    END IF;

    INSERT INTO audit_log (user_id, module, action, entity_name, details, severity)
    VALUES (v_uid, 'security', 'bale_otp_config_updated',
    'security.' || p_key,
    'مقدار جدید: ' || v_new_val,
    'warning');

    RETURN jsonb_build_object('ok', true, 'key', p_key, 'value', v_new_val);
  END IF;

  -- ── If ENABLING: validate ALL prerequisites ───────────────────────────────

  -- Prerequisite 1: Bale channel must be active
  SELECT COALESCE(is_active, false), COALESCE(bot_token, ''), COALESCE(bot_username, '')
  INTO v_bale_active, v_bot_token, v_bot_username
  FROM social_channel_configs
  WHERE channel = 'bale'
  LIMIT 1;

  IF NOT FOUND OR NOT v_bale_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BALE_CHANNEL_INACTIVE');
  END IF;

  -- Prerequisite 2: bot_token must be set
  IF btrim(v_bot_token) = '' OR v_bot_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BALE_BOT_TOKEN_MISSING');
  END IF;

  -- Prerequisite 3: bot_username must be set
  IF btrim(v_bot_username) = '' OR v_bot_username IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BALE_BOT_USERNAME_MISSING');
  END IF;

  -- Prerequisite 4: notification template must be active and contain {{otp}}
  v_template_event_type := CASE p_key
    WHEN 'phone_login_bale_otp_enabled' THEN 'login_otp_bale'
    WHEN 'phone_password_recovery_bale_otp_enabled' THEN 'password_reset_otp_bale'
  END;

  SELECT COALESCE(is_active, false), body
  INTO v_template_active, v_template_body
  FROM notification_templates
  WHERE category = 'auth'
    AND event_type = v_template_event_type
    AND audience = 'all'
  LIMIT 1;

  IF NOT FOUND OR NOT v_template_active
     OR v_template_body IS NULL
     OR v_template_body NOT LIKE '%{{otp}}%' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BALE_TEMPLATE_NOT_READY');
  END IF;

  -- ── All prerequisites passed: enable ──────────────────────────────────────
  v_new_val := 'true';

  UPDATE system_config
  SET value = v_new_val, updated_at = now()
  WHERE section = 'security' AND key = p_key;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFIG_NOT_FOUND');
  END IF;

  INSERT INTO audit_log (user_id, module, action, entity_name, details, severity)
  VALUES (v_uid, 'security', 'bale_otp_config_updated',
  'security.' || p_key,
  'مقدار جدید: ' || v_new_val,
  'warning');

  RETURN jsonb_build_object('ok', true, 'key', p_key, 'value', v_new_val);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_bale_auth_otp_config(text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_bale_auth_otp_config(text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_bale_auth_otp_config(text, boolean) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. get_bale_auth_dispatch_summary: lightweight admin-only RPC
--    Returns only status counts + last cleaned error code.
--    NO OTP, phone, or chat_id returned.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_bale_auth_dispatch_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_count_sent int := 0;
  v_count_failed int := 0;
  v_count_skipped int := 0;
  v_count_processing int := 0;
  v_total int := 0;
  v_last_error text;
  v_last_status text;
  v_last_purpose text;
  v_last_at timestamptz;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles
  WHERE user_id = v_uid
  LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status = 'sent'),
    COUNT(*) FILTER (WHERE status = 'failed'),
    COUNT(*) FILTER (WHERE status = 'skipped'),
    COUNT(*) FILTER (WHERE status = 'processing'),
    COUNT(*)
  INTO v_count_sent, v_count_failed, v_count_skipped, v_count_processing, v_total
  FROM public.bale_auth_code_dispatches;

  -- Last dispatch with a cleaned error code (no raw API response body)
  SELECT error_code, status, purpose, completed_at
  INTO v_last_error, v_last_status, v_last_purpose, v_last_at
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
    'last_error_code', v_last_error,
    'last_status', v_last_status,
    'last_purpose', v_last_purpose,
    'last_at', v_last_at
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_bale_auth_dispatch_summary() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_bale_auth_dispatch_summary() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_bale_auth_dispatch_summary() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. get_auth_runtime_status: admin-only boolean readiness RPC
--    Returns only booleans — no secrets, tokens, full origins, or raw values.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_auth_runtime_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;

  v_hook_secret_set boolean := false;
  v_rate_limit_pepper_set boolean := false;
  v_allowed_origins_set boolean := false;
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

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles
  WHERE user_id = v_uid
  LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- Hook secret: check if SEND_SMS_HOOK_SECRET is set (cannot read value, only existence)
  -- We check system_config for operator_confirmed as proxy for "hook configured"
  SELECT (value = 'true') INTO v_hook_secret_set
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed'
  LIMIT 1;
  v_hook_secret_set := COALESCE(v_hook_secret_set, false);

  -- Rate limit pepper: cannot read env var from SQL, but we can check if
  -- the pepper config exists in system_config (if stored there).
  -- The actual pepper is in Deno env. We check if rate-limiting has been
  -- configured by looking at whether the pepper row exists.
  -- Since the pepper is an Edge Function env var (not in DB), we check
  -- a system_config flag that admin sets after configuring it.
  SELECT (value = 'true') INTO v_rate_limit_pepper_set
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_rate_limit_pepper_configured'
  LIMIT 1;
  v_rate_limit_pepper_set := COALESCE(v_rate_limit_pepper_set, false);

  -- Allowed origins
  SELECT value INTO v_origins_count
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_allowed_origins'
  LIMIT 1;
  v_origins_count := COALESCE(array_length(string_to_array(COALESCE(v_origins_count::text, ''), ','), ','), 0);
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

  -- Login SMS template
  BEGIN
    SELECT body INTO v_login_template_body
    FROM public.notification_templates
    WHERE category = 'auth' AND event_type = 'login_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;
    v_login_template_ready := v_login_template_body IS NOT NULL
      AND v_login_template_body LIKE '%{{otp}}%';
  EXCEPTION WHEN OTHERS THEN
    v_login_template_ready := false;
  END;

  -- Recovery SMS template
  BEGIN
    SELECT body INTO v_recovery_template_body
    FROM public.notification_templates
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

  -- Bale login template
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

  -- Bale recovery template
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
    'hook_secret_confirmed', v_hook_secret_set,
    'rate_limit_pepper_configured', v_rate_limit_pepper_set,
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
