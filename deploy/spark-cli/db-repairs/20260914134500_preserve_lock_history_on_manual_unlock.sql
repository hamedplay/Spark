BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auth_lock_reset_at timestamptz;

CREATE OR REPLACE FUNCTION public.record_auth_failure(
  p_user_id uuid,
  p_identifier_hash text,
  p_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_progressive_enabled boolean := false;
  v_recent_failures integer;
  v_threshold integer := 5;
  v_fixed_lock_minutes integer := 30;
  v_schedule text[] := ARRAY['1','6','12','24','48','72']::text[];
  v_current_lock_level integer;
  v_new_lock_level integer;
  v_lock_hours integer;
  v_locked_until timestamptz;
  v_profile_locked_until timestamptz;
  v_lock_reset_at timestamptz;
  v_failure_window_start timestamptz;
  v_schedule_len integer;
BEGIN
  IF p_user_id IS NULL OR p_identifier_hash IS NULL OR p_ip_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;

  SELECT
    COALESCE(progressive_lock_enabled, false),
    COALESCE(lock_threshold, 5),
    COALESCE(lock_duration_minutes, 30),
    COALESCE(progressive_lock_schedule, ARRAY['1','6','12','24','48','72']::text[])
  INTO v_progressive_enabled, v_threshold, v_fixed_lock_minutes, v_schedule
  FROM public.auth_security_settings
  WHERE id = 1
  LIMIT 1;

  v_threshold := GREATEST(1, LEAST(v_threshold, 50));
  v_fixed_lock_minutes := GREATEST(1, LEAST(v_fixed_lock_minutes, 1440));

  IF COALESCE(array_length(v_schedule, 1), 0) < 1
     OR COALESCE(array_length(v_schedule, 1), 0) > 12
     OR EXISTS (
       SELECT 1
       FROM unnest(COALESCE(v_schedule, ARRAY[]::text[])) AS entry
       WHERE CASE
         WHEN entry ~ '^[0-9]+$' THEN entry::integer < 1 OR entry::integer > 720
         ELSE true
       END
     ) THEN
    v_schedule := ARRAY['1','6','12','24','48','72']::text[];
  END IF;
  v_schedule_len := array_length(v_schedule, 1);

  SELECT locked_until, auth_lock_reset_at
  INTO v_profile_locked_until, v_lock_reset_at
  FROM public.profiles
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_profile_locked_until IS NOT NULL AND v_profile_locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', true,
      'locked', true,
      'locked_until', v_profile_locked_until,
      'rate_limited', false
    );
  END IF;

  v_failure_window_start := GREATEST(
    now() - interval '24 hours',
    COALESCE(v_lock_reset_at, '-infinity'::timestamptz)
  );

  SELECT count(*) INTO v_recent_failures
  FROM public.auth_lock_events
  WHERE user_id = p_user_id
    AND created_at > v_failure_window_start;

  INSERT INTO public.auth_lock_events (
    user_id, identifier_hash, ip_hash, failure_count, lock_level, locked_until
  ) VALUES (
    p_user_id, p_identifier_hash, p_ip_hash, 1, 0, NULL
  );

  v_recent_failures := v_recent_failures + 1;

  IF v_recent_failures < v_threshold THEN
    RETURN jsonb_build_object(
      'ok', true,
      'locked', false,
      'rate_limited', false,
      'failures', v_recent_failures
    );
  END IF;

  IF NOT v_progressive_enabled THEN
    v_locked_until := now() + make_interval(mins => v_fixed_lock_minutes);

    UPDATE public.profiles
    SET locked_until = v_locked_until
    WHERE user_id = p_user_id;

    UPDATE public.auth_lock_events
    SET failure_count = v_recent_failures,
        lock_level = 0,
        locked_until = v_locked_until
    WHERE id = (
      SELECT id FROM public.auth_lock_events
      WHERE user_id = p_user_id
      ORDER BY created_at DESC
      LIMIT 1
    );

    RETURN jsonb_build_object(
      'ok', true,
      'locked', true,
      'progressive', false,
      'locked_until', v_locked_until,
      'lock_minutes', v_fixed_lock_minutes
    );
  END IF;

  SELECT COALESCE(max(lock_level), 0) INTO v_current_lock_level
  FROM public.auth_lock_events
  WHERE user_id = p_user_id
    AND lock_level > 0
    AND locked_until IS NOT NULL
    AND locked_until > now() - interval '72 hours'
    AND created_at > COALESCE(v_lock_reset_at, '-infinity'::timestamptz);

  v_new_lock_level := v_current_lock_level + 1;

  IF v_new_lock_level > v_schedule_len THEN
    UPDATE public.profiles
    SET account_status = 'LOCKED', locked_until = NULL
    WHERE user_id = p_user_id;

    UPDATE public.auth_lock_events
    SET failure_count = v_recent_failures,
        lock_level = v_new_lock_level,
        locked_until = now() + interval '72 hours'
    WHERE id = (
      SELECT id FROM public.auth_lock_events
      WHERE user_id = p_user_id
      ORDER BY created_at DESC
      LIMIT 1
    );

    RETURN jsonb_build_object(
      'ok', true,
      'locked', true,
      'progressive', true,
      'admin_unlock_required', true,
      'lock_level', v_new_lock_level
    );
  END IF;

  v_lock_hours := v_schedule[v_new_lock_level]::integer;
  v_locked_until := now() + make_interval(hours => v_lock_hours);

  UPDATE public.profiles
  SET locked_until = v_locked_until
  WHERE user_id = p_user_id;

  UPDATE public.auth_lock_events
  SET failure_count = v_recent_failures,
      lock_level = v_new_lock_level,
      locked_until = v_locked_until
  WHERE id = (
    SELECT id FROM public.auth_lock_events
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT 1
  );

  RETURN jsonb_build_object(
    'ok', true,
    'locked', true,
    'progressive', true,
    'locked_until', v_locked_until,
    'lock_level', v_new_lock_level,
    'lock_hours', v_lock_hours
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.list_locked_accounts()
RETURNS TABLE(
  user_id uuid,
  full_name text,
  email text,
  username text,
  phone text,
  account_status text,
  locked_until timestamptz,
  lock_type text,
  lock_level integer,
  failure_count integer,
  last_failure_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_session_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_session_id := NULL;
  END;

  IF v_session_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions s
    WHERE s.id = v_session_id AND s.user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'SESSION_INVALID' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.user_id = v_actor
      AND actor.is_security_admin IS TRUE
      AND actor.is_active IS TRUE
      AND actor.account_status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'SECURITY_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.user_id,
    p.full_name::text,
    p.email::text,
    p.username::text,
    p.phone::text,
    p.account_status::text,
    p.locked_until,
    CASE WHEN p.account_status = 'LOCKED' THEN 'admin' ELSE 'temporary' END::text,
    COALESCE(last_event.lock_level, 0)::integer,
    COALESCE(last_event.failure_count, 0)::integer,
    last_event.created_at
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT e.lock_level, e.failure_count, e.created_at
    FROM public.auth_lock_events e
    WHERE e.user_id = p.user_id
      AND e.created_at > COALESCE(p.auth_lock_reset_at, '-infinity'::timestamptz)
    ORDER BY e.created_at DESC
    LIMIT 1
  ) last_event ON TRUE
  WHERE p.account_status = 'LOCKED'
     OR (p.locked_until IS NOT NULL AND p.locked_until > now())
  ORDER BY
    CASE WHEN p.account_status = 'LOCKED' THEN 0 ELSE 1 END,
    p.locked_until DESC NULLS FIRST,
    lower(COALESCE(p.full_name, p.email, p.username, '')),
    p.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.security_admin_unlock_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_grant_id uuid;
  v_previous_status text;
  v_previous_locked_until timestamptz;
  v_reset_at timestamptz := clock_timestamp();
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END;

  IF v_session_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions s
    WHERE s.id = v_session_id AND s.user_id = v_actor
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.user_id = v_actor
      AND actor.is_security_admin IS TRUE
      AND actor.is_active IS TRUE
      AND actor.account_status = 'ACTIVE'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_USER_ID');
  END IF;

  SELECT p.account_status, p.locked_until
  INTO v_previous_status, v_previous_locked_until
  FROM public.profiles p
  WHERE p.user_id = p_user_id
    AND (
      p.account_status = 'LOCKED'
      OR (p.locked_until IS NOT NULL AND p.locked_until > now())
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_LOCKED');
  END IF;

  SELECT g.id INTO v_grant_id
  FROM public.session_security_grants g
  WHERE g.user_id = v_actor
    AND g.session_id = v_session_id
    AND g.grant_type = 'mfa_stepup'
    AND g.purpose = 'account_security_change'
    AND g.factor_type = 'totp'
    AND g.assurance_level = 'aal2'
    AND g.consumed_at IS NULL
    AND g.expires_at > now()
  ORDER BY g.issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_grant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  UPDATE public.session_security_grants
  SET consumed_at = now()
  WHERE id = v_grant_id AND consumed_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  UPDATE public.profiles
  SET
    locked_until = NULL,
    auth_lock_reset_at = v_reset_at,
    account_status = CASE WHEN account_status = 'LOCKED' THEN 'ACTIVE' ELSE account_status END,
    account_status_changed_at = CASE WHEN account_status = 'LOCKED' THEN v_reset_at ELSE account_status_changed_at END,
    account_status_changed_by = CASE WHEN account_status = 'LOCKED' THEN v_actor ELSE account_status_changed_by END,
    updated_at = v_reset_at
  WHERE user_id = p_user_id;

  INSERT INTO public.security_audit_events (
    user_id, actor_user_id, event_type, event_category, severity,
    metadata, session_id, result
  ) VALUES (
    p_user_id,
    v_actor,
    'account_unlocked_by_security_admin',
    'account_lock',
    'info',
    jsonb_build_object(
      'previous_status', v_previous_status,
      'previous_locked_until', v_previous_locked_until,
      'failure_counter_reset_at', v_reset_at,
      'unlock_type', CASE WHEN v_previous_status = 'LOCKED' THEN 'admin' ELSE 'temporary' END
    ),
    v_session_id,
    'success'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'previous_status', v_previous_status,
    'previous_locked_until', v_previous_locked_until,
    'failure_counter_reset_at', v_reset_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_locked_accounts()
RETURNS TABLE(
  user_id uuid,
  full_name text,
  email text,
  username text,
  phone text,
  account_status text,
  locked_until timestamptz,
  lock_type text,
  lock_level integer,
  failure_count integer,
  last_failure_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT * FROM private.list_locked_accounts(); $$;

CREATE OR REPLACE FUNCTION public.security_admin_unlock_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT private.security_admin_unlock_account($1::uuid); $$;

REVOKE ALL ON FUNCTION private.list_locked_accounts() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.security_admin_unlock_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_locked_accounts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.security_admin_unlock_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_locked_accounts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.security_admin_unlock_account(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
