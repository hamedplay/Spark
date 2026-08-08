-- Phase 8: Health Check RPC + Audit Read Model Hardening
-- No data deletion, no table/column changes, no RLS policy changes on existing tables

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Health Check RPC (read-only, no secret values returned)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_auth_health_check()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_settings record;
  v_missing_tables text[] := '{}';
  v_missing_rpcs text[] := '{}';
  v_rls_ok boolean := true;
  v_search_path_ok boolean := true;
  v_tbl text;
  v_rpc text;
  v_tables text[] := ARRAY[
    'auth_security_settings','profiles','audit_log','security_audit_events',
    'custom_mfa_factors','custom_mfa_challenges','custom_mfa_grants','custom_mfa_recovery_codes',
    'unified_recovery_challenges','auth_lock_events','session_security_state',
    'unified_recovery_rate_limit','phone_password_reset_challenges'
  ];
  v_rpcs text[] := ARRAY[
    'get_my_auth_access_state','get_public_auth_config','get_public_login_methods',
    'get_security_audit_page','hmac_with_pepper','resolve_unified_recovery_target',
    'create_unified_recovery_challenge','verify_unified_recovery_challenge',
    'claim_unified_recovery_completion','finalize_unified_recovery_completion',
    'record_auth_failure','check_account_lock_status',
    'register_session_security_state','touch_session_security_state',
    'revoke_session_security_state','revoke_other_sessions','revoke_all_sessions',
    'get_my_session_security_state','consume_unified_recovery_rate_limit',
    'admin_unlock_account'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = v_tbl) THEN
      v_missing_tables := array_append(v_missing_tables, v_tbl);
    END IF;
  END LOOP;

  FOREACH v_rpc IN ARRAY v_rpcs LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = v_rpc
    ) THEN
      v_missing_rpcs := array_append(v_missing_rpcs, v_rpc);
    END IF;
  END LOOP;

  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = v_tbl) THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'public' AND c.relname = v_tbl AND c.relrowsecurity = true
      ) THEN
        v_rls_ok := false;
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND p.proconfig IS NOT NULL
    AND NOT (p.proconfig @> ARRAY['search_path='])
  ) THEN
    v_search_path_ok := false;
  END IF;

  SELECT * INTO v_settings FROM public.auth_security_settings WHERE id = 1 LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'timestamp', now()::text,
    'tables', jsonb_build_object(
      'required', to_jsonb(v_tables),
      'missing', to_jsonb(v_missing_tables),
      'all_present', array_length(v_missing_tables, 1) IS NULL
    ),
    'rpcs', jsonb_build_object(
      'required', to_jsonb(v_rpcs),
      'missing', to_jsonb(v_missing_rpcs),
      'all_present', array_length(v_missing_rpcs, 1) IS NULL
    ),
    'rls', jsonb_build_object('all_enabled', v_rls_ok),
    'security_definer', jsonb_build_object('search_path_empty', v_search_path_ok),
    'settings', jsonb_build_object(
      'unified_recovery_enabled', v_settings.unified_recovery_enabled,
      'progressive_lock_enabled', v_settings.progressive_lock_enabled,
      'session_management_enabled', v_settings.session_management_enabled,
      'custom_mfa_enabled', v_settings.custom_mfa_enabled,
      'recovery_enabled', v_settings.recovery_enabled,
      'mfa_policy', v_settings.mfa_policy,
      'username_login', v_settings.username_login,
      'email_login', v_settings.email_login,
      'phone_login', v_settings.phone_login
    ),
    'secrets', jsonb_build_object(
      'mfa_pepper', CASE WHEN current_setting('app.mfa_pepper', true) IS NOT NULL AND length(current_setting('app.mfa_pepper', true)) > 0 THEN 'ready' ELSE 'not_ready' END,
      'auth_pepper', CASE WHEN current_setting('app.auth_pepper', true) IS NOT NULL AND length(current_setting('app.auth_pepper', true)) > 0 THEN 'ready' ELSE 'not_ready' END,
      'mfa_encryption_key', CASE WHEN current_setting('app.mfa_encryption_key', true) IS NOT NULL AND length(current_setting('app.mfa_encryption_key', true)) > 0 THEN 'ready' ELSE 'not_ready' END
    ),
    'deprecated_routes', jsonb_build_array(
      jsonb_build_object('route', 'request-phone-password-reset-otp', 'status', 'replaced_by_unified_recovery', 'action', '410_after_cutover'),
      jsonb_build_object('route', 'verify-phone-password-reset-otp', 'status', 'replaced_by_unified_recovery', 'action', '410_after_cutover'),
      jsonb_build_object('route', 'complete-phone-password-reset', 'status', 'replaced_by_unified_recovery', 'action', '410_after_cutover')
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_auth_health_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_health_check() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Enhanced audit read model: add request_id filter
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_security_audit_page_v2(
  p_category text DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_result text DEFAULT NULL,
  p_event_type text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
  p_target_user_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_rows jsonb;
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED'); END IF;

  SELECT is_admin INTO v_is_admin FROM public.profiles WHERE user_id = v_uid AND is_active = true LIMIT 1;
  IF NOT COALESCE(v_is_admin, false) THEN
    IF NOT EXISTS (SELECT 1 FROM public.security_admin_roles WHERE user_id = v_uid AND is_active = true LIMIT 1) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
    END IF;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', e.id,
    'created_at', e.created_at,
    'event_type', e.event_type,
    'event_category', e.event_category,
    'severity', e.severity,
    'result', e.result,
    'error_code', e.error_code,
    'actor_user_id', e.actor_user_id,
    'target_user_id', e.target_user_id,
    'session_id', e.session_id,
    'request_id', e.request_id,
    'metadata', e.metadata
  )) INTO v_rows
  FROM public.security_audit_events e
  WHERE (p_category IS NULL OR e.event_category = p_category)
    AND (p_severity IS NULL OR e.severity = p_severity)
    AND (p_result IS NULL OR e.result = p_result)
    AND (p_event_type IS NULL OR e.event_type = p_event_type)
    AND (p_actor_user_id IS NULL OR e.actor_user_id = p_actor_user_id)
    AND (p_target_user_id IS NULL OR e.target_user_id = p_target_user_id)
    AND (p_from IS NULL OR e.created_at >= p_from)
    AND (p_to IS NULL OR e.created_at <= p_to)
    AND (p_request_id IS NULL OR e.request_id = p_request_id)
    AND (p_before_created_at IS NULL OR (e.created_at, e.id) < (p_before_created_at, p_before_id))
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT LEAST(p_limit, 200);

  SELECT count(*) INTO v_total FROM public.security_audit_events
  WHERE (p_category IS NULL OR event_category = p_category)
    AND (p_severity IS NULL OR severity = p_severity)
    AND (p_result IS NULL OR result = p_result)
    AND (p_event_type IS NULL OR event_type = p_event_type)
    AND (p_actor_user_id IS NULL OR actor_user_id = p_actor_user_id)
    AND (p_target_user_id IS NULL OR target_user_id = p_target_user_id)
    AND (p_from IS NULL OR created_at >= p_from)
    AND (p_to IS NULL OR created_at <= p_to)
    AND (p_request_id IS NULL OR request_id = p_request_id);

  RETURN jsonb_build_object('ok', true, 'events', COALESCE(v_rows, '[]'::jsonb), 'total', v_total);
END;
$$;
REVOKE ALL ON FUNCTION public.get_security_audit_page_v2(text, text, text, text, uuid, uuid, timestamptz, timestamptz, integer, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_security_audit_page_v2(text, text, text, text, uuid, uuid, timestamptz, timestamptz, integer, timestamptz, uuid, uuid) TO authenticated;
