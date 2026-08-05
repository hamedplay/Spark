/*
# Phase 3C Read RPC Runtime and Artifact Drift Fix

## Summary
Fixes three functions:
1. get_security_admin_management_state — CTE scope: all CTE-dependent outputs in one statement
2. get_security_audit_page — CTE scope: v_events and v_has_more in one statement; fix p.target_user_id typo
3. set_user_security_admin — add fast authorization check before global lock

## Safety
- No prior migration modified
- No data deleted/reset/truncated
- No MFA policy changed
- No experimental factors/grants/audits created
- No security admin added or removed
*/

-- ════════════════════════════════════════════════════════════
-- 1. set_user_security_admin — add fast auth check before lock
-- ════════════════════════════════════════════════════════════

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
AS $function$
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
  v_grant_consumed_count integer;
BEGIN
  -- 1. Authentication
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  -- 2. Session extraction and validation
  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REQUIRED');
  END IF;

  v_request_id := NULLIF(v_jwt ->> 'request_id', '')::uuid;

  SELECT EXISTS(
    SELECT 1 FROM auth.sessions
    WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT not_after INTO v_session_not_after
  FROM auth.sessions WHERE id = v_session_id LIMIT 1;

  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_EXPIRED');
  END IF;

  -- 3. Input validation
  IF p_target_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_REQUIRED');
  END IF;

  IF p_new_value IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NEW_VALUE_REQUIRED');
  END IF;

  IF p_expected_version IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EXPECTED_VERSION_REQUIRED');
  END IF;

  -- 3a. Change reason validation
  v_trimmed_reason := NULLIF(trim(COALESCE(p_change_reason, '')), '');
  IF v_trimmed_reason IS NULL THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change', 'CHANGE_REASON_REQUIRED', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'CHANGE_REASON_REQUIRED');
  END IF;
  IF length(v_trimmed_reason) < 10 THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change', 'CHANGE_REASON_TOO_SHORT', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'CHANGE_REASON_TOO_SHORT');
  END IF;
  IF length(v_trimmed_reason) > 500 THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change', 'CHANGE_REASON_TOO_LONG', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'CHANGE_REASON_TOO_LONG');
  END IF;

  -- 4. Self-change check
  IF p_target_user_id = v_uid THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change', 'CANNOT_CHANGE_OWN_SECURITY_ADMIN', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_CHANGE_OWN_SECURITY_ADMIN');
  END IF;

  -- 5. Fast authorization check BEFORE global lock
  IF NOT public.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  -- 6. Global advisory lock (constant, NOT target-specific)
  PERFORM pg_advisory_xact_lock(987654321);

  -- 7. Re-check actor after acquiring lock
  IF NOT public.is_current_security_admin() THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change', 'FORBIDDEN', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- 8. Target lookup with FOR UPDATE
  SELECT
    user_id, is_security_admin, is_active, account_status,
    security_role_version
  INTO v_target_rec
  FROM public.profiles
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change', 'TARGET_NOT_FOUND', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_FOUND');
  END IF;

  -- 9. Target validation (BEFORE grant consumption)

  -- 9a. No-op check
  IF p_new_value IS TRUE AND v_target_rec.is_security_admin IS TRUE THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change', 'NO_EFFECTIVE_CHANGE', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EFFECTIVE_CHANGE');
  END IF;
  IF p_new_value IS FALSE AND v_target_rec.is_security_admin IS NOT TRUE THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change', 'NO_EFFECTIVE_CHANGE', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EFFECTIVE_CHANGE');
  END IF;

  -- 9b. Grant operation validation
  IF p_new_value IS TRUE THEN
    IF NOT v_target_rec.is_active OR v_target_rec.account_status != 'ACTIVE' THEN
      PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change', 'TARGET_NOT_ELIGIBLE', p_target_user_id, v_request_id);
      RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_ELIGIBLE');
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM auth.mfa_factors f
      WHERE f.user_id = p_target_user_id
        AND f.factor_type = 'totp'
        AND f.status = 'verified'
    ) INTO v_target_has_totp;

    IF NOT v_target_has_totp THEN
      PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change', 'TARGET_TOTP_REQUIRED', p_target_user_id, v_request_id);
      RETURN jsonb_build_object('ok', false, 'error', 'TARGET_TOTP_REQUIRED');
    END IF;

  -- 9c. Revoke operation validation
  ELSE
    IF v_target_rec.is_active AND v_target_rec.account_status = 'ACTIVE' THEN
      SELECT count(*) INTO v_sec_admin_count
      FROM public.profiles
      WHERE is_security_admin IS TRUE
        AND is_active IS TRUE
        AND account_status = 'ACTIVE'
        AND user_id != p_target_user_id;

      IF v_sec_admin_count = 0 THEN
        PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change', 'CANNOT_REMOVE_LAST_SECURITY_ADMIN', p_target_user_id, v_request_id);
        RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_REMOVE_LAST_SECURITY_ADMIN');
      END IF;
    END IF;
  END IF;

  -- 10. Step-up grant validation and consumption (AFTER all target validation)
  SELECT * INTO v_stepup_grant
  FROM public.session_security_grants
  WHERE user_id = v_uid
    AND session_id = v_session_id
    AND grant_type = 'mfa_stepup'
    AND purpose = 'account_security_change'
    AND factor_type = 'totp'
    AND assurance_level = 'aal2'
    AND consumed_at IS NULL
    AND issued_at <= clock_timestamp()
    AND issued_at >= clock_timestamp() - interval '5 minutes'
    AND expires_at > clock_timestamp()
  ORDER BY issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_stepup_required', 'STEPUP_REQUIRED', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  -- 10a. Consume grant with consumed_at IS NULL guard
  UPDATE public.session_security_grants
  SET consumed_at = clock_timestamp()
  WHERE id = v_stepup_grant.id
    AND consumed_at IS NULL;

  GET DIAGNOSTICS v_grant_consumed_count = ROW_COUNT;

  IF v_grant_consumed_count = 0 THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_stepup_required', 'STEPUP_REQUIRED', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  -- 11. Final optimistic version check (AFTER grant consumption)
  IF v_target_rec.security_role_version != p_expected_version THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change', 'VERSION_CONFLICT', p_target_user_id, v_request_id);
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'VERSION_CONFLICT',
      'current_version', v_target_rec.security_role_version
    );
  END IF;

  -- 12. Role update
  v_before_state := jsonb_build_object(
    'is_security_admin', v_target_rec.is_security_admin,
    'security_role_version', v_target_rec.security_role_version
  );

  v_new_version := v_target_rec.security_role_version + 1;

  UPDATE public.profiles
  SET
    is_security_admin = p_new_value,
    security_role_version = v_new_version
  WHERE user_id = p_target_user_id;

  v_after_state := jsonb_build_object(
    'is_security_admin', p_new_value,
    'security_role_version', v_new_version
  );

  -- 13. History
  INSERT INTO public.security_admin_role_history (
    target_user_id, actor_user_id,
    old_value, new_value,
    old_version, new_version,
    session_id, request_id,
    change_reason
  ) VALUES (
    p_target_user_id, v_uid,
    v_target_rec.is_security_admin, p_new_value,
    v_target_rec.security_role_version, v_new_version,
    v_session_id, v_request_id,
    v_trimmed_reason
  );

  -- 14. Audit
  INSERT INTO public.security_audit_events (
    actor_user_id, target_user_id,
    event_type, event_category, severity,
    session_id, request_id,
    result, before_state, after_state,
    metadata
  ) VALUES (
    v_uid, p_target_user_id,
    'security_admin_role_changed', 'access', 'warning',
    v_session_id, v_request_id,
    'success',
    public.sanitize_audit_metadata(v_before_state),
    public.sanitize_audit_metadata(v_after_state),
    public.sanitize_audit_metadata(jsonb_build_object(
      'change_reason_present', true,
      'old_version', v_target_rec.security_role_version,
      'new_version', v_new_version
    ))
  );

  RETURN jsonb_build_object(
    'ok', true,
    'new_version', v_new_version
  );
END;
$function$;

ALTER FUNCTION public.set_user_security_admin(uuid, boolean, integer, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.set_user_security_admin(uuid, boolean, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_security_admin(uuid, boolean, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_user_security_admin(uuid, boolean, integer, text) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 2. get_security_admin_management_state — CTE scope fix
-- All CTE-dependent outputs (users, has_more, total_matches)
-- computed in a single statement
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_security_admin_management_state(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
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
  v_total_matches int;
  v_has_more boolean := false;
  v_pagination jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT not_after INTO v_session_not_after
  FROM auth.sessions WHERE id = v_session_id LIMIT 1;

  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  IF NOT public.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  IF v_limit < 1 OR v_limit > 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LIMIT');
  END IF;

  IF v_offset < 0 OR v_offset > 10000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_OFFSET');
  END IF;

  v_search := NULLIF(trim(COALESCE(p_search, '')), '');
  IF v_search IS NOT NULL AND length(v_search) > 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SEARCH_TOO_LONG');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM auth.mfa_factors
    WHERE user_id = v_uid AND factor_type = 'totp' AND status = 'verified'
  ) INTO v_actor_has_totp;

  -- Single statement: users + has_more + total_matches all from same CTE scope
  WITH filtered_users AS (
    SELECT
      p.user_id, p.full_name, p.username, p.email, p.avatar_url,
      p.is_admin, p.is_active, p.account_status,
      p.is_security_admin, p.security_role_version
    FROM public.profiles p
    WHERE (
      p.is_security_admin IS TRUE
      OR (p.is_active IS TRUE AND p.account_status = 'ACTIVE')
    )
    AND (
      v_search IS NULL
      OR position(lower(v_search) in lower(COALESCE(p.full_name, ''))) > 0
      OR position(lower(v_search) in lower(COALESCE(p.username, ''))) > 0
      OR position(lower(v_search) in lower(COALESCE(p.email, ''))) > 0
    )
  ),
  page_plus_one AS (
    SELECT * FROM filtered_users
    ORDER BY
      CASE WHEN is_security_admin IS TRUE THEN 0 ELSE 1 END,
      full_name NULLS LAST,
      user_id
    LIMIT v_limit + 1
    OFFSET v_offset
  ),
  visible_page AS (
    SELECT * FROM page_plus_one
    LIMIT v_limit
  )
  SELECT
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', vp.user_id,
          'full_name', vp.full_name,
          'username', vp.username,
          'email', vp.email,
          'avatar_url', vp.avatar_url,
          'is_admin', vp.is_admin,
          'is_active', vp.is_active,
          'account_status', vp.account_status,
          'is_security_admin', vp.is_security_admin,
          'security_role_version', vp.security_role_version,
          'has_verified_totp', EXISTS(
            SELECT 1 FROM auth.mfa_factors f
            WHERE f.user_id = vp.user_id AND f.factor_type = 'totp' AND f.status = 'verified'
          ),
          'is_current_actor', (vp.user_id = v_uid),
          'eligibility', jsonb_build_object(
            'can_grant', (
              vp.user_id != v_uid
              AND vp.is_active IS TRUE
              AND vp.account_status = 'ACTIVE'
              AND vp.is_security_admin IS NOT TRUE
              AND EXISTS(
                SELECT 1 FROM auth.mfa_factors f
                WHERE f.user_id = vp.user_id AND f.factor_type = 'totp' AND f.status = 'verified'
              )
            ),
            'can_revoke', (
              vp.user_id != v_uid
              AND vp.is_security_admin IS TRUE
              AND NOT (
                vp.is_active IS TRUE AND vp.account_status = 'ACTIVE'
                AND (
                  SELECT count(*) FROM public.profiles p2
                  WHERE p2.is_security_admin IS TRUE
                    AND p2.is_active IS TRUE
                    AND p2.account_status = 'ACTIVE'
                    AND p2.user_id != vp.user_id
                ) = 0
              )
            ),
            'blocked_reason', CASE
              WHEN vp.user_id = v_uid THEN 'SELF_CHANGE_FORBIDDEN'
              WHEN vp.is_security_admin IS TRUE THEN
                CASE
                  WHEN vp.is_active IS TRUE AND vp.account_status = 'ACTIVE'
                    AND (
                      SELECT count(*) FROM public.profiles p2
                      WHERE p2.is_security_admin IS TRUE
                        AND p2.is_active IS TRUE
                        AND p2.account_status = 'ACTIVE'
                        AND p2.user_id != vp.user_id
                    ) = 0
                  THEN 'LAST_ACTIVE_SECURITY_ADMIN'
                  ELSE 'ELIGIBLE'
                END
              WHEN NOT vp.is_active OR vp.account_status != 'ACTIVE' THEN 'ACCOUNT_NOT_ACTIVE'
              WHEN NOT EXISTS(
                SELECT 1 FROM auth.mfa_factors f
                WHERE f.user_id = vp.user_id AND f.factor_type = 'totp' AND f.status = 'verified'
              ) THEN 'TOTP_REQUIRED'
              ELSE 'ELIGIBLE'
            END
          )
        ) ORDER BY
          CASE WHEN vp.is_security_admin IS TRUE THEN 0 ELSE 1 END,
          vp.full_name NULLS LAST,
          vp.user_id
        )
        FROM visible_page vp
      ),
      '[]'::jsonb
    ),
    (
      SELECT count(*) > v_limit
      FROM page_plus_one
    ),
    (
      SELECT count(*)
      FROM filtered_users
    )
  INTO
    v_users,
    v_has_more,
    v_total_matches;

  v_pagination := jsonb_build_object(
    'limit', v_limit,
    'offset', v_offset,
    'has_more', v_has_more,
    'total_matches', v_total_matches
  );

  -- Summary counts
  SELECT count(DISTINCT p.user_id) INTO v_total_users
  FROM public.profiles p
  WHERE (p.is_security_admin IS TRUE)
    OR (p.is_active IS TRUE AND p.account_status = 'ACTIVE');

  SELECT count(DISTINCT p.user_id) INTO v_active_sec_admins
  FROM public.profiles p
  WHERE p.is_security_admin IS TRUE
    AND p.is_active IS TRUE
    AND p.account_status = 'ACTIVE';

  SELECT count(DISTINCT p.user_id) INTO v_sec_admins_without_totp
  FROM public.profiles p
  WHERE p.is_security_admin IS TRUE
    AND p.is_active IS TRUE
    AND p.account_status = 'ACTIVE'
    AND NOT EXISTS(
      SELECT 1 FROM auth.mfa_factors f
      WHERE f.user_id = p.user_id AND f.factor_type = 'totp' AND f.status = 'verified'
    );

  SELECT count(DISTINCT p.user_id) INTO v_eligible_candidates
  FROM public.profiles p
  WHERE p.user_id != v_uid
    AND p.is_active IS TRUE
    AND p.account_status = 'ACTIVE'
    AND p.is_security_admin IS NOT TRUE
    AND EXISTS(
      SELECT 1 FROM auth.mfa_factors f
      WHERE f.user_id = p.user_id AND f.factor_type = 'totp' AND f.status = 'verified'
    );

  v_summary := jsonb_build_object(
    'total_users', v_total_users,
    'active_security_admins', v_active_sec_admins,
    'security_admins_without_verified_totp', v_sec_admins_without_totp,
    'eligible_promotion_candidates', v_eligible_candidates,
    'current_actor_has_verified_totp', v_actor_has_totp
  );

  -- Role history: limit BEFORE aggregate
  SELECT jsonb_agg(jsonb_build_object(
    'id', h.id,
    'target_user_id', h.target_user_id,
    'target_display_name', COALESCE(tp.full_name, tp.username, h.target_user_id::text),
    'actor_user_id', h.actor_user_id,
    'actor_display_name', COALESCE(ap.full_name, ap.username, h.actor_user_id::text),
    'old_value', h.old_value,
    'new_value', h.new_value,
    'old_version', h.old_version,
    'new_version', h.new_version,
    'change_reason', h.change_reason,
    'changed_at', h.changed_at
  ) ORDER BY h.changed_at DESC, h.id DESC) INTO v_history
  FROM (
    SELECT *
    FROM public.security_admin_role_history
    ORDER BY changed_at DESC, id DESC
    LIMIT 50
  ) h
  LEFT JOIN public.profiles tp ON tp.user_id = h.target_user_id
  LEFT JOIN public.profiles ap ON ap.user_id = h.actor_user_id;

  IF v_history IS NULL THEN
    v_history := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'users', v_users,
    'pagination', v_pagination,
    'summary', v_summary,
    'history', v_history
  );
END;
$function$;

ALTER FUNCTION public.get_security_admin_management_state(text, integer, integer) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_security_admin_management_state(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_security_admin_management_state(text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_security_admin_management_state(text, integer, integer) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 3. get_security_audit_page — CTE scope fix + target alias fix
-- v_events and v_has_more computed in single statement
-- Fix: e.target_user_id = p.target_user_id → e.target_user_id = p_target_user_id
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_security_audit_page(
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
  p_before_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
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
  v_last_created_at text;
  v_last_id text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT not_after INTO v_session_not_after
  FROM auth.sessions WHERE id = v_session_id LIMIT 1;

  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  IF NOT public.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  IF v_limit < 1 OR v_limit > 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LIMIT');
  END IF;

  IF (p_before_created_at IS NULL) != (p_before_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CURSOR');
  END IF;

  IF p_category IS NOT NULL AND p_category NOT IN (
    'auth', 'mfa', 'recovery', 'session', 'access', 'account_lock', 'settings_change'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CATEGORY');
  END IF;

  IF p_severity IS NOT NULL AND p_severity NOT IN (
    'info', 'warning', 'error', 'critical'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SEVERITY');
  END IF;

  IF p_result IS NOT NULL AND p_result NOT IN (
    'success', 'failure', 'denied', 'error'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_RESULT');
  END IF;

  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_DATE_RANGE');
  END IF;

  -- Single statement: events + has_more from same CTE scope
  WITH filtered_events AS (
    SELECT
      e.id, e.created_at, e.event_type, e.event_category,
      e.severity, e.result, e.error_code,
      e.actor_user_id, e.target_user_id,
      e.request_id, e.session_id,
      e.metadata, e.before_state, e.after_state
    FROM public.security_audit_events e
    WHERE
      (p_category IS NULL OR e.event_category = p_category)
      AND (p_severity IS NULL OR e.severity = p_severity)
      AND (p_result IS NULL OR e.result = p_result)
      AND (p_event_type IS NULL OR e.event_type = p_event_type)
      AND (p_actor_user_id IS NULL OR e.actor_user_id = p_actor_user_id)
      AND (
        p_target_user_id IS NULL
        OR e.target_user_id = p_target_user_id
      )
      AND (p_from IS NULL OR e.created_at >= p_from)
      AND (p_to IS NULL OR e.created_at <= p_to)
      AND (
        p_before_created_at IS NULL
        OR (e.created_at, e.id) < (p_before_created_at, p_before_id)
      )
  ),
  page_plus_one AS (
    SELECT * FROM filtered_events
    ORDER BY created_at DESC, id DESC
    LIMIT v_limit + 1
  ),
  visible_page AS (
    SELECT * FROM page_plus_one
    LIMIT v_limit
  )
  SELECT
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object(
          'id', vp.id,
          'created_at', vp.created_at,
          'event_type', vp.event_type,
          'event_category', vp.event_category,
          'severity', vp.severity,
          'result', vp.result,
          'error_code', vp.error_code,
          'actor', CASE WHEN vp.actor_user_id IS NOT NULL THEN
            jsonb_build_object(
              'user_id', vp.actor_user_id,
              'display_name', COALESCE(ap.full_name, ap.username, vp.actor_user_id::text)
            )
          ELSE NULL END,
          'target', CASE WHEN vp.target_user_id IS NOT NULL THEN
            jsonb_build_object(
              'user_id', vp.target_user_id,
              'display_name', COALESCE(tp.full_name, tp.username, vp.target_user_id::text)
            )
          ELSE NULL END,
          'request_id', vp.request_id,
          'session_id', vp.session_id,
          'metadata', CASE WHEN vp.metadata IS NULL THEN NULL ELSE public.sanitize_audit_metadata(vp.metadata) END,
          'before_state', CASE WHEN vp.before_state IS NULL THEN NULL ELSE public.sanitize_audit_metadata(vp.before_state) END,
          'after_state', CASE WHEN vp.after_state IS NULL THEN NULL ELSE public.sanitize_audit_metadata(vp.after_state) END
        ) ORDER BY vp.created_at DESC, vp.id DESC)
        FROM visible_page vp
        LEFT JOIN public.profiles ap ON ap.user_id = vp.actor_user_id
        LEFT JOIN public.profiles tp ON tp.user_id = vp.target_user_id
      ),
      '[]'::jsonb
    ),
    (
      SELECT count(*) > v_limit
      FROM page_plus_one
    )
  INTO
    v_events,
    v_has_more;

  -- Build next_cursor from v_events (no CTE reference needed)
  v_count := jsonb_array_length(v_events);
  IF v_has_more AND v_count > 0 THEN
    v_last_created_at := v_events -> (v_count - 1) ->> 'created_at';
    v_last_id := v_events -> (v_count - 1) ->> 'id';
    v_next_cursor := jsonb_build_object(
      'before_created_at', v_last_created_at,
      'before_id', v_last_id
    );
  ELSE
    v_next_cursor := NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'events', v_events,
    'has_more', v_has_more,
    'next_cursor', v_next_cursor
  );
END;
$function$;

ALTER FUNCTION public.get_security_audit_page(text, text, text, text, uuid, uuid, timestamptz, timestamptz, integer, timestamptz, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_security_audit_page(text, text, text, text, uuid, uuid, timestamptz, timestamptz, integer, timestamptz, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_security_audit_page(text, text, text, text, uuid, uuid, timestamptz, timestamptz, integer, timestamptz, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_security_audit_page(text, text, text, text, uuid, uuid, timestamptz, timestamptz, integer, timestamptz, uuid) TO authenticated;
