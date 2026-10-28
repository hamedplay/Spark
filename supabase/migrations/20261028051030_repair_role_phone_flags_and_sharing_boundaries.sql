-- New migration: repair only the audited role, phone-auth and sharing RPCs.
-- Keep existing role, step-up and version contracts; reuse the canonical FULL gate.
CREATE OR REPLACE FUNCTION private.set_user_security_admin(p_target_user_id uuid, p_new_value boolean, p_expected_version integer, p_change_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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

  IF NOT private.is_current_session_fully_authorized() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH_ACCESS_RESTRICTED');
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

CREATE OR REPLACE FUNCTION private.set_phone_auth_canonical_flags(p_login_enabled boolean DEFAULT NULL::boolean, p_recovery_enabled boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_grant_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  IF NOT private.is_current_session_fully_authorized() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH_ACCESS_RESTRICTED');
  END IF;

  IF p_login_enabled IS NULL AND p_recovery_enabled IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EFFECTIVE_CHANGE');
  END IF;

  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_session_id := NULL;
  END;

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REQUIRED');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.sessions s
    WHERE s.id = v_session_id
      AND s.user_id = v_uid
      AND (s.not_after IS NULL OR s.not_after > clock_timestamp())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  IF NOT private.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  SELECT g.id
  INTO v_grant_id
  FROM public.session_security_grants g
  WHERE g.user_id = v_uid
    AND g.session_id = v_session_id
    AND g.grant_type = 'mfa_stepup'
    AND g.purpose = 'auth_settings_change'
    AND g.factor_type = 'totp'
    AND g.assurance_level = 'aal2'
    AND g.consumed_at IS NULL
    AND g.expires_at > clock_timestamp()
  ORDER BY g.issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_grant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  UPDATE public.session_security_grants
  SET consumed_at = clock_timestamp()
  WHERE id = v_grant_id;

  IF p_login_enabled IS NOT NULL THEN
    INSERT INTO public.system_config (
      section, key, value, value_type, description, updated_by, updated_at
    )
    VALUES (
      'security',
      'phone_login_canonical_enabled',
      p_login_enabled::text,
      'boolean',
      'Canonical feature flag for phone OTP login',
      v_uid,
      clock_timestamp()
    )
    ON CONFLICT (section, key) DO UPDATE
    SET value = EXCLUDED.value,
        value_type = EXCLUDED.value_type,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;
  END IF;

  IF p_recovery_enabled IS NOT NULL THEN
    INSERT INTO public.system_config (
      section, key, value, value_type, description, updated_by, updated_at
    )
    VALUES (
      'security',
      'phone_password_recovery_canonical_enabled',
      p_recovery_enabled::text,
      'boolean',
      'Canonical feature flag for password recovery via phone OTP',
      v_uid,
      clock_timestamp()
    )
    ON CONFLICT (section, key) DO UPDATE
    SET value = EXCLUDED.value,
        value_type = EXCLUDED.value_type,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;
  END IF;

  INSERT INTO public.security_audit_events (
    user_id,
    actor_user_id,
    event_type,
    event_category,
    severity,
    session_id,
    result,
    metadata
  )
  VALUES (
    v_uid,
    v_uid,
    'phone_auth_canonical_flags_changed',
    'settings_change',
    'warning',
    v_session_id,
    'success',
    jsonb_build_object(
      'login_enabled', p_login_enabled,
      'recovery_enabled', p_recovery_enabled
    )
  );

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION private.share_note_to_user(p_title text, p_content text, p_note_type text, p_recipient_id uuid, p_sender_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501';
  END IF;
  IF NOT private.is_current_session_fully_authorized() THEN
    RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED' USING ERRCODE='42501';
  END IF;

  -- Match the organization boundary of the recipient directory in the UI.
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles sender
    JOIN public.profiles recipient ON recipient.organization=sender.organization
    WHERE sender.user_id=auth.uid()
      AND NULLIF(btrim(sender.organization),'') IS NOT NULL
      AND recipient.user_id=p_recipient_id
      AND recipient.account_status='ACTIVE'
      AND recipient.is_active IS TRUE
      AND COALESCE(recipient.is_hidden,false)=false
  ) THEN
    RAISE EXCEPTION 'RECIPIENT_NOT_ALLOWED' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.notes(title,content,note_type,status,user_id)
  VALUES(p_title,p_content,p_note_type,'active',p_recipient_id);
END;
$function$;

CREATE OR REPLACE FUNCTION private.share_contact_to_user(p_name text, p_email text, p_phone text, p_company text, p_target_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501';
  END IF;
  IF NOT private.is_current_session_fully_authorized() THEN
    RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED' USING ERRCODE='42501';
  END IF;
  IF auth.uid()=p_target_user_id THEN
    RAISE EXCEPTION 'Cannot share contact to yourself';
  END IF;
  -- Match the organization boundary of the recipient directory in the UI.
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles sender
    JOIN public.profiles recipient ON recipient.organization=sender.organization
    WHERE sender.user_id=auth.uid()
      AND NULLIF(btrim(sender.organization),'') IS NOT NULL
      AND recipient.user_id=p_target_user_id
      AND recipient.account_status='ACTIVE'
      AND recipient.is_active IS TRUE
      AND COALESCE(recipient.is_hidden,false)=false
  ) THEN
    RAISE EXCEPTION 'RECIPIENT_NOT_ALLOWED' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.contacts_email(name,email,phone,company,user_id)
  VALUES(p_name,p_email,p_phone,p_company,p_target_user_id);
END;
$function$;
