/*
# Phase 3C — Security Admin Management & Audit Console

## Summary
Hardens the security admin role management system and adds two new read RPCs
for the security administration console.

## Safety
- No prior migration modified
- No data deleted/reset/truncated
- No MFA policy changed
- No experimental factors/grants created
- No security admin added or removed
*/

-- 1. Hardened set_user_security_admin
CREATE OR REPLACE FUNCTION public.set_user_security_admin(
  p_target_user_id uuid,
  p_new_value boolean,
  p_expected_version integer,
  p_change_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS \$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_session_id uuid;
  v_request_id uuid;
  v_session_exists boolean := false;
  v_session_not_after timestamptz;
  v_target_rec record;
  v_sec_admin_count integer;
  v_stepup_grant public.session_security_grants%ROWTYPE;
  v_trimmed_reason text;
  v_before_state jsonb;
  v_after_state jsonb;
  v_target_has_totp boolean := false;
  v_new_version integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;
  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REQUIRED');
  END IF;
  v_request_id := NULLIF(v_jwt ->> 'request_id', '')::uuid;
  SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid) INTO v_session_exists;
  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;
  SELECT not_after INTO v_session_not_after FROM auth.sessions WHERE id = v_session_id LIMIT 1;
  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_EXPIRED');
  END IF;
  IF NOT public.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;
  IF p_target_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_REQUIRED');
  END IF;
  IF p_new_value IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NEW_VALUE_REQUIRED');
  END IF;
  IF p_expected_version IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EXPECTED_VERSION_REQUIRED');
  END IF;
  v_trimmed_reason := NULLIF(trim(COALESCE(p_change_reason, '')), '');
  IF v_trimmed_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHANGE_REASON_REQUIRED');
  END IF;
  IF length(v_trimmed_reason) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHANGE_REASON_TOO_SHORT');
  END IF;
  IF length(v_trimmed_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHANGE_REASON_TOO_LONG');
  END IF;
  IF p_target_user_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_CHANGE_OWN_SECURITY_ADMIN');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('set_user_security_admin:' || p_target_user_id::text, 0));
  SELECT user_id, is_security_admin, is_active, account_status, security_role_version
  INTO v_target_rec FROM public.profiles WHERE user_id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_FOUND');
  END IF;
  IF v_target_rec.security_role_version != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_CONFLICT', 'current_version', v_target_rec.security_role_version);
  END IF;
  SELECT * INTO v_stepup_grant FROM public.session_security_grants
  WHERE user_id = v_uid AND session_id = v_session_id
    AND grant_type = 'mfa_stepup' AND purpose = 'account_security_change'
    AND factor_type = 'totp' AND assurance_level = 'aal2'
    AND consumed_at IS NULL AND expires_at > clock_timestamp() AND issued_at <= clock_timestamp()
  ORDER BY issued_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_stepup_required', 'STEPUP_REQUIRED', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;
  UPDATE public.session_security_grants SET consumed_at = clock_timestamp() WHERE id = v_stepup_grant.id;
  IF p_new_value THEN
    IF NOT v_target_rec.is_active OR v_target_rec.account_status != 'ACTIVE' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_ELIGIBLE');
    END IF;
    SELECT EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p_target_user_id AND f.factor_type = 'totp' AND f.status = 'verified') INTO v_target_has_totp;
    IF NOT v_target_has_totp THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TARGET_TOTP_REQUIRED');
    END IF;
    IF v_target_rec.is_security_admin THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NO_EFFECTIVE_CHANGE');
    END IF;
  ELSE
    IF NOT v_target_rec.is_security_admin THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NO_EFFECTIVE_CHANGE');
    END IF;
    IF v_target_rec.is_active AND v_target_rec.account_status = 'ACTIVE' THEN
      SELECT count(*) INTO v_sec_admin_count FROM public.profiles
      WHERE is_security_admin IS TRUE AND is_active IS TRUE AND account_status = 'ACTIVE' AND user_id != p_target_user_id;
      IF v_sec_admin_count = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_REMOVE_LAST_SECURITY_ADMIN');
      END IF;
    END IF;
  END IF;
  v_before_state := jsonb_build_object('is_security_admin', v_target_rec.is_security_admin, 'security_role_version', v_target_rec.security_role_version);
  v_new_version := v_target_rec.security_role_version + 1;
  UPDATE public.profiles SET is_security_admin = p_new_value, security_role_version = v_new_version WHERE user_id = p_target_user_id;
  v_after_state := jsonb_build_object('is_security_admin', p_new_value, 'security_role_version', v_new_version);
  INSERT INTO public.security_admin_role_history (target_user_id, actor_user_id, old_value, new_value, old_version, new_version, session_id, request_id, change_reason)
  VALUES (p_target_user_id, v_uid, v_target_rec.is_security_admin, p_new_value, v_target_rec.security_role_version, v_new_version, v_session_id, v_request_id, v_trimmed_reason);
  INSERT INTO public.security_audit_events (actor_user_id, target_user_id, event_type, event_category, severity, session_id, request_id, result, before_state, after_state, metadata)
  VALUES (v_uid, p_target_user_id, 'security_admin_role_changed', 'access', 'warning', v_session_id, v_request_id, 'success', v_before_state, v_after_state,
    public.sanitize_audit_metadata(jsonb_build_object('change_reason', v_trimmed_reason, 'old_version', v_target_rec.security_role_version, 'new_version', v_new_version)));
  RETURN jsonb_build_object('ok', true, 'new_version', v_new_version);
END;
\$;

ALTER FUNCTION public.set_user_security_admin(uuid, boolean, integer, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.set_user_security_admin(uuid, boolean, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_security_admin(uuid, boolean, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_user_security_admin(uuid, boolean, integer, text) TO authenticated;

-- 2. get_security_admin_management_state RPC
CREATE OR REPLACE FUNCTION public.get_security_admin_management_state(
  p_search text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS \$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_session_id uuid;
  v_session_exists boolean := false;
  v_session_not_after timestamptz;
  v_search text;
  v_limit int := COALESCE(p_limit, 50);
  v_offset int := COALESCE(p_offset, 0);
  v_users jsonb;
  v_summary jsonb;
  v_history jsonb;
  v_active_sec_admins int;
  v_sec_admins_without_totp int;
  v_eligible_candidates int;
  v_actor_has_totp boolean := false;
  v_total_users int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED'); END IF;
  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID'); END IF;
  SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid) INTO v_session_exists;
  IF NOT v_session_exists THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID'); END IF;
  SELECT not_after INTO v_session_not_after FROM auth.sessions WHERE id = v_session_id LIMIT 1;
  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;
  IF NOT public.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;
  IF v_limit < 1 OR v_limit > 100 THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LIMIT'); END IF;
  IF v_offset < 0 OR v_offset > 10000 THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_OFFSET'); END IF;
  v_search := NULLIF(trim(COALESCE(p_search, '')), '');
  IF v_search IS NOT NULL AND length(v_search) > 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SEARCH_TOO_LONG');
  END IF;
  SELECT EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id = v_uid AND factor_type = 'totp' AND status = 'verified') INTO v_actor_has_totp;
  SELECT jsonb_agg(jsonb_build_object(
    'user_id', p.user_id, 'full_name', p.full_name, 'username', p.username, 'email', p.email, 'avatar_url', p.avatar_url,
    'is_admin', p.is_admin, 'is_active', p.is_active, 'account_status', p.account_status,
    'is_security_admin', p.is_security_admin, 'security_role_version', p.security_role_version,
    'has_verified_totp', EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p.user_id AND f.factor_type = 'totp' AND f.status = 'verified'),
    'is_current_actor', (p.user_id = v_uid),
    'eligibility', jsonb_build_object(
      'can_grant', (p.user_id != v_uid AND p.is_active IS TRUE AND p.account_status = 'ACTIVE' AND p.is_security_admin IS NOT TRUE
        AND EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p.user_id AND f.factor_type = 'totp' AND f.status = 'verified')),
      'can_revoke', (p.user_id != v_uid AND p.is_security_admin IS TRUE
        AND NOT (p.is_active IS TRUE AND p.account_status = 'ACTIVE'
          AND (SELECT count(*) FROM public.profiles p2 WHERE p2.is_security_admin IS TRUE AND p2.is_active IS TRUE AND p2.account_status = 'ACTIVE' AND p2.user_id != p.user_id) = 0)),
      'blocked_reason', CASE
        WHEN p.user_id = v_uid THEN 'SELF_CHANGE_FORBIDDEN'
        WHEN p.is_security_admin IS TRUE THEN 'ALREADY_SECURITY_ADMIN'
        WHEN NOT p.is_active OR p.account_status != 'ACTIVE' THEN 'ACCOUNT_NOT_ACTIVE'
        WHEN NOT EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p.user_id AND f.factor_type = 'totp' AND f.status = 'verified') THEN 'TOTP_REQUIRED'
        ELSE 'ELIGIBLE'
      END
    )
  ) ORDER BY CASE WHEN p.is_security_admin IS TRUE THEN 0 ELSE 1 END, p.full_name NULLS LAST) INTO v_users
  FROM public.profiles p
  WHERE (p.is_security_admin IS TRUE) OR (p.is_active IS TRUE AND p.account_status = 'ACTIVE')
  AND (v_search IS NULL OR position(lower(v_search) in lower(COALESCE(p.full_name, ''))) > 0
    OR position(lower(v_search) in lower(COALESCE(p.username, ''))) > 0
    OR position(lower(v_search) in lower(COALESCE(p.email, ''))) > 0)
  LIMIT v_limit + 1 OFFSET v_offset;
  IF v_users IS NULL THEN v_users := '[]'::jsonb; END IF;
  SELECT count(DISTINCT p.user_id) INTO v_total_users FROM public.profiles p
  WHERE (p.is_security_admin IS TRUE) OR (p.is_active IS TRUE AND p.account_status = 'ACTIVE');
  SELECT count(DISTINCT p.user_id) INTO v_active_sec_admins FROM public.profiles p
  WHERE p.is_security_admin IS TRUE AND p.is_active IS TRUE AND p.account_status = 'ACTIVE';
  SELECT count(DISTINCT p.user_id) INTO v_sec_admins_without_totp FROM public.profiles p
  WHERE p.is_security_admin IS TRUE AND p.is_active IS TRUE AND p.account_status = 'ACTIVE'
    AND NOT EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p.user_id AND f.factor_type = 'totp' AND f.status = 'verified');
  SELECT count(DISTINCT p.user_id) INTO v_eligible_candidates FROM public.profiles p
  WHERE p.user_id != v_uid AND p.is_active IS TRUE AND p.account_status = 'ACTIVE' AND p.is_security_admin IS NOT TRUE
    AND EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p.user_id AND f.factor_type = 'totp' AND f.status = 'verified');
  v_summary := jsonb_build_object('total_users', v_total_users, 'active_security_admins', v_active_sec_admins,
    'security_admins_without_verified_totp', v_sec_admins_without_totp, 'eligible_promotion_candidates', v_eligible_candidates,
    'current_actor_has_verified_totp', v_actor_has_totp);
  SELECT jsonb_agg(jsonb_build_object(
    'id', h.id, 'target_user_id', h.target_user_id,
    'target_display_name', COALESCE(tp.full_name, tp.username, h.target_user_id::text),
    'actor_user_id', h.actor_user_id, 'actor_display_name', COALESCE(ap.full_name, ap.username, h.actor_user_id::text),
    'old_value', h.old_value, 'new_value', h.new_value, 'old_version', h.old_version, 'new_version', h.new_version,
    'change_reason', h.change_reason, 'changed_at', h.changed_at
  ) ORDER BY h.changed_at DESC, h.id DESC) INTO v_history
  FROM public.security_admin_role_history h
  LEFT JOIN public.profiles tp ON tp.user_id = h.target_user_id
  LEFT JOIN public.profiles ap ON ap.user_id = h.actor_user_id
  LIMIT 50;
  IF v_history IS NULL THEN v_history := '[]'::jsonb; END IF;
  RETURN jsonb_build_object('ok', true, 'users', v_users, 'summary', v_summary, 'history', v_history);
END;
\$;

ALTER FUNCTION public.get_security_admin_management_state(text, integer, integer) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_security_admin_management_state(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_security_admin_management_state(text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_security_admin_management_state(text, integer, integer) TO authenticated;

-- 3. get_security_audit_page RPC
CREATE OR REPLACE FUNCTION public.get_security_audit_page(
  p_category text DEFAULT NULL, p_severity text DEFAULT NULL, p_result text DEFAULT NULL,
  p_event_type text DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL, p_target_user_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50, p_before_created_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS \$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_session_id uuid;
  v_session_exists boolean := false;
  v_session_not_after timestamptz;
  v_limit int := COALESCE(p_limit, 50);
  v_events jsonb;
  v_has_more boolean := false;
  v_next_cursor jsonb;
  v_count int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED'); END IF;
  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID'); END IF;
  SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid) INTO v_session_exists;
  IF NOT v_session_exists THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID'); END IF;
  SELECT not_after INTO v_session_not_after FROM auth.sessions WHERE id = v_session_id LIMIT 1;
  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;
  IF NOT public.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;
  IF v_limit < 1 OR v_limit > 100 THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LIMIT'); END IF;
  IF (p_before_created_at IS NULL) != (p_before_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CURSOR');
  END IF;
  IF p_category IS NOT NULL AND p_category NOT IN ('auth', 'mfa', 'recovery', 'session', 'access', 'account_lock', 'settings_change') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CATEGORY');
  END IF;
  IF p_severity IS NOT NULL AND p_severity NOT IN ('info', 'warning', 'error', 'critical') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SEVERITY');
  END IF;
  IF p_result IS NOT NULL AND p_result NOT IN ('success', 'failure', 'denied', 'error') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_RESULT');
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_DATE_RANGE');
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'id', e.id, 'created_at', e.created_at, 'event_type', e.event_type,
    'event_category', e.event_category, 'severity', e.severity, 'result', e.result,
    'error_code', e.error_code,
    'actor', CASE WHEN e.actor_user_id IS NOT NULL THEN jsonb_build_object('user_id', e.actor_user_id, 'display_name', COALESCE(ap.full_name, ap.username, e.actor_user_id::text)) ELSE NULL END,
    'target', CASE WHEN e.target_user_id IS NOT NULL THEN jsonb_build_object('user_id', e.target_user_id, 'display_name', COALESCE(tp.full_name, tp.username, e.target_user_id::text)) ELSE NULL END,
    'request_id', e.request_id, 'session_id', e.session_id,
    'metadata', public.sanitize_audit_metadata(e.metadata),
    'before_state', public.sanitize_audit_metadata(e.before_state),
    'after_state', public.sanitize_audit_metadata(e.after_state)
  ) ORDER BY e.created_at DESC, e.id DESC) INTO v_events
  FROM public.security_audit_events e
  LEFT JOIN public.profiles ap ON ap.user_id = e.actor_user_id
  LEFT JOIN public.profiles tp ON tp.user_id = e.target_user_id
  WHERE (p_category IS NULL OR e.event_category = p_category)
    AND (p_severity IS NULL OR e.severity = p_severity)
    AND (p_result IS NULL OR e.result = p_result)
    AND (p_event_type IS NULL OR e.event_type = p_event_type)
    AND (p_actor_user_id IS NULL OR e.actor_user_id = p_actor_user_id)
    AND (p_target_user_id IS NULL OR e.target_user_id = p_target_user_id)
    AND (p_from IS NULL OR e.created_at >= p_from)
    AND (p_to IS NULL OR e.created_at <= p_to)
    AND (p_before_created_at IS NULL OR (e.created_at, e.id) < (p_before_created_at, p_before_id))
  LIMIT v_limit + 1;
  IF v_events IS NULL THEN v_events := '[]'::jsonb; END IF;
  v_count := jsonb_array_length(v_events);
  IF v_count > v_limit THEN
    v_has_more := true;
    v_next_cursor := jsonb_build_object('before_created_at', v_events -> (v_limit - 1) ->> 'created_at', 'before_id', v_events -> (v_limit - 1) ->> 'id');
  ELSE
    v_has_more := false;
    v_next_cursor := NULL;
  END IF;
  RETURN jsonb_build_object('ok', true, 'events', v_events, 'has_more', v_has_more, 'next_cursor', v_next_cursor);
END;
\$;

ALTER FUNCTION public.get_security_audit_page(text, text, text, text, uuid, uuid, timestamptz, timestamptz, integer, timestamptz, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_security_audit_page(text, text, text, text, uuid, uuid, timestamptz, timestamptz, integer, timestamptz, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_security_audit_page(text, text, text, text, uuid, uuid, timestamptz, timestamptz, integer, timestamptz, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_security_audit_page(text, text, text, text, uuid, uuid, timestamptz, timestamptz, integer, timestamptz, uuid) TO authenticated;

-- 4. Indexes (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_security_audit_events_created_id ON public.security_audit_events (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_events_actor_created ON public.security_audit_events (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_events_target_created ON public.security_audit_events (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_admin_role_history_changed_id ON public.security_admin_role_history (changed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_security_admin_role_history_target_changed ON public.security_admin_role_history (target_user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_admin_role_history_actor_changed ON public.security_admin_role_history (actor_user_id, changed_at DESC);

-- 5. ACL Hardening
REVOKE SELECT ON public.security_audit_events FROM anon;
REVOKE SELECT ON public.security_audit_events FROM authenticated;
REVOKE SELECT ON public.security_admin_role_history FROM anon;
REVOKE SELECT ON public.security_admin_role_history FROM authenticated;
REVOKE SELECT ON public.session_security_grants FROM anon;
