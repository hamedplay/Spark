/*
# Phase 5E-D5A Fix: Fail-closed Activation Revalidation

## Purpose
Revalidate the phone OTP login backend activation with a fail-closed gate.
The backend is first set to `false`, then all preconditions are checked against
the live schema. Only if every precondition passes is the flag flipped back to
`true`. If any precondition fails, the flag stays `false` and a WARNING is raised.

## Changes
1. `system_config` row `phone_otp_login_backend_ready`:
   - Step 1: Set to `false` (fail-safe shutdown).
   - Step 2: Verify row count is exactly 1.
   - Step 3: If all preconditions pass, set to `true` only if currently `false`.

## Preconditions Checked (all must pass)
1. `phone_login_canonical_enabled = true`
2. TTL between 30 and 300
3. Resend between 30 and 300
4. Resend <= TTL
5. Max Attempts between 3 and 10
6. Provider: valid UUID in `system_config(sms, phone_login_sms_provider_id)`
   and `sms_providers.is_active = true` for that ID.
7. Template: exactly one active row in `public.sms_templates` with
   `category = 'auth'`, `event_type = 'login_otp'`, `audience = 'all'`,
   containing exactly one `{{otp}}` placeholder.
8. `get_phone_auth_config()` returns exactly one row with
   `length(pepper) >= 32` and `allowed_origins` includes `https://shahrmeeting.ir`.
9. All seven public RPCs exist:
   - consume_phone_otp_login_rate_limit_v2
   - create_phone_otp_login_challenge_v2
   - set_phone_otp_login_delivery_v2
   - claim_phone_otp_login_challenge_v2
   - release_phone_otp_login_challenge_v2
   - authorize_phone_otp_gateway_session_v1
   - reconcile_phone_otp_gateway_session_v1

## Safety
- No INSERT, DELETE, TRUNCATE, DROP, or ALTER.
- No tables created, altered, or dropped.
- No columns added, removed, or type-changed.
- No RLS policies created or modified.
- No edge functions deployed or invoked.
- No SMS, OTP, login, or session created.
- Fail-closed: if any precondition fails, flag stays `false`.
- Idempotent: safe to re-run.
- Previous migration (20260806222947) is NOT changed, removed, or renamed.

## Important Notes
1. This migration ONLY changes the `phone_otp_login_backend_ready` flag value.
2. No RPCs are recreated or modified.
3. No frontend code is changed.
4. No edge function code is changed.
*/

DO $$
DECLARE
  v_row_count     integer;
  v_canonical     boolean := false;
  v_ttl_text      text;
  v_ttl           integer;
  v_resend_text   text;
  v_resend        integer;
  v_max_attempts_text text;
  v_max_attempts  integer;
  v_provider_id_text text;
  v_provider_id   uuid;
  v_provider_active boolean := false;
  v_template_count integer := 0;
  v_otp_count     integer := 0;
  v_config_result record;
  v_pepper_len    integer := 0;
  v_origins_ok    boolean := false;
  v_rpc_count     integer := 0;
  v_preflight_ok  boolean := true;
  v_fail_reason   text := '';
BEGIN
  -- ──────────────────────────────────────────────────────────────
  -- Step 1: Fail-safe shutdown — set flag to false
  -- ──────────────────────────────────────────────────────────────
  UPDATE public.system_config
  SET value = 'false', updated_at = now()
  WHERE section = 'security' AND key = 'phone_otp_login_backend_ready';

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count <> 1 THEN
    RAISE WARNING 'phone_otp_login_backend_ready row count = %, expected 1. Backend stays false.', v_row_count;
    -- Do NOT raise an exception; the shutdown must not be rolled back.
    RETURN;
  END IF;

  -- ──────────────────────────────────────────────────────────────
  -- Step 2: Validate preconditions against live schema
  -- ──────────────────────────────────────────────────────────────

  -- 2a. phone_login_canonical_enabled = true
  BEGIN
    SELECT (value = 'true') INTO v_canonical
    FROM public.system_config WHERE section = 'security' AND key = 'phone_login_canonical_enabled' LIMIT 1;
    v_canonical := COALESCE(v_canonical, false);
  EXCEPTION WHEN OTHERS THEN v_canonical := false; END;

  IF NOT v_canonical THEN
    v_preflight_ok := false;
    v_fail_reason := COALESCE(v_fail_reason || '; ', '') || 'phone_login_canonical_enabled is not true';
  END IF;

  -- 2b. TTL between 30 and 300
  SELECT value INTO v_ttl_text FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_ttl_seconds' LIMIT 1;
  BEGIN
    v_ttl := COALESCE(v_ttl_text::integer, 0);
  EXCEPTION WHEN OTHERS THEN v_ttl := 0; END;

  IF NOT (v_ttl >= 30 AND v_ttl <= 300) THEN
    v_preflight_ok := false;
    v_fail_reason := COALESCE(v_fail_reason || '; ', '') || 'TTL not in [30,300]';
  END IF;

  -- 2c. Resend between 30 and 300
  SELECT value INTO v_resend_text FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_resend_seconds' LIMIT 1;
  BEGIN
    v_resend := COALESCE(v_resend_text::integer, 0);
  EXCEPTION WHEN OTHERS THEN v_resend := 0; END;

  IF NOT (v_resend >= 30 AND v_resend <= 300) THEN
    v_preflight_ok := false;
    v_fail_reason := COALESCE(v_fail_reason || '; ', '') || 'resend not in [30,300]';
  END IF;

  -- 2d. Resend <= TTL
  IF v_ttl IS NOT NULL AND v_resend IS NOT NULL AND v_resend > v_ttl THEN
    v_preflight_ok := false;
    v_fail_reason := COALESCE(v_fail_reason || '; ', '') || 'resend > TTL';
  END IF;

  -- 2e. Max Attempts between 3 and 10
  SELECT value INTO v_max_attempts_text FROM public.system_config WHERE section = 'security' AND key = 'phone_otp_login_max_attempts' LIMIT 1;
  BEGIN
    v_max_attempts := COALESCE(v_max_attempts_text::integer, 0);
  EXCEPTION WHEN OTHERS THEN v_max_attempts := 0; END;

  IF NOT (v_max_attempts >= 3 AND v_max_attempts <= 10) THEN
    v_preflight_ok := false;
    v_fail_reason := COALESCE(v_fail_reason || '; ', '') || 'max_attempts not in [3,10]';
  END IF;

  -- 2f. Provider: valid UUID and is_active = true
  SELECT value INTO v_provider_id_text FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;
  BEGIN
    v_provider_id := v_provider_id_text::uuid;
  EXCEPTION WHEN OTHERS THEN v_provider_id := NULL; END;

  IF v_provider_id IS NULL THEN
    v_preflight_ok := false;
    v_fail_reason := COALESCE(v_fail_reason || '; ', '') || 'provider_id is not a valid UUID';
  ELSE
    BEGIN
      SELECT COALESCE(is_active, false) INTO v_provider_active
      FROM public.sms_providers WHERE id = v_provider_id LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_provider_active := false; END;

    IF NOT v_provider_active THEN
      v_preflight_ok := false;
      v_fail_reason := COALESCE(v_fail_reason || '; ', '') || 'provider is not active';
    END IF;
  END IF;

  -- 2g. Template: exactly one active login_otp template with exactly one {{otp}}
  BEGIN
    SELECT COUNT(*), COUNT(CASE WHEN body LIKE '%{{otp}}%' THEN 1 END)
    INTO v_template_count, v_otp_count
    FROM public.sms_templates
    WHERE category = 'auth' AND event_type = 'login_otp' AND audience = 'all' AND is_active = true;
  EXCEPTION WHEN OTHERS THEN
    v_template_count := 0;
    v_otp_count := 0;
  END;

  IF NOT (v_template_count = 1 AND v_otp_count = 1) THEN
    v_preflight_ok := false;
    v_fail_reason := COALESCE(v_fail_reason || '; ', '') || 'template count/otp mismatch';
  END IF;

  -- 2h. get_phone_auth_config(): exactly one row, pepper >= 32, origins include shahrmeeting.ir
  BEGIN
    SELECT * INTO v_config_result FROM public.get_phone_auth_config() LIMIT 1;
    IF NOT FOUND THEN
      v_preflight_ok := false;
      v_fail_reason := COALESCE(v_fail_reason || '; ', '') || 'get_phone_auth_config returned no row';
    ELSE
      v_pepper_len := COALESCE(length(v_config_result.pepper), 0);
      IF v_pepper_len < 32 THEN
        v_preflight_ok := false;
        v_fail_reason := COALESCE(v_fail_reason || '; ', '') || 'pepper length < 32';
      END IF;

      BEGIN
        SELECT EXISTS(
          SELECT 1 FROM unnest(v_config_result.allowed_origins) AS origin
          WHERE origin = 'https://shahrmeeting.ir'
        ) INTO v_origins_ok;
      EXCEPTION WHEN OTHERS THEN v_origins_ok := false; END;

      IF NOT v_origins_ok THEN
        v_preflight_ok := false;
        v_fail_reason := COALESCE(v_fail_reason || '; ', '') || 'https://shahrmeeting.ir not in allowed_origins';
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_preflight_ok := false;
    v_fail_reason := COALESCE(v_fail_reason || '; ', '') || 'get_phone_auth_config threw exception';
  END;

  -- 2i. All seven public RPCs exist
  BEGIN
    SELECT COUNT(*) INTO v_rpc_count
    FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name IN (
        'consume_phone_otp_login_rate_limit_v2',
        'create_phone_otp_login_challenge_v2',
        'set_phone_otp_login_delivery_v2',
        'claim_phone_otp_login_challenge_v2',
        'release_phone_otp_login_challenge_v2',
        'authorize_phone_otp_gateway_session_v1',
        'reconcile_phone_otp_gateway_session_v1'
      );
  EXCEPTION WHEN OTHERS THEN v_rpc_count := 0; END;

  IF v_rpc_count <> 7 THEN
    v_preflight_ok := false;
    v_fail_reason := COALESCE(v_fail_reason || '; ', '') || 'missing RPCs (found ' || v_rpc_count || ' of 7)';
  END IF;

  -- ──────────────────────────────────────────────────────────────
  -- Step 3: Only if all preconditions pass, flip to true
  -- ──────────────────────────────────────────────────────────────
  IF v_preflight_ok THEN
    UPDATE public.system_config
    SET value = 'true', updated_at = now()
    WHERE section = 'security'
      AND key = 'phone_otp_login_backend_ready'
      AND value = 'false';

    GET DIAGNOSTICS v_row_count = ROW_COUNT;

    IF v_row_count <> 1 THEN
      RAISE WARNING 'Activation UPDATE affected % rows, expected 1. Backend may already be true.', v_row_count;
    END IF;
  ELSE
    RAISE WARNING 'Preflight failed. Backend stays false. Reasons: %', v_fail_reason;
  END IF;
END $$;
