BEGIN;

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
    SELECT 1
    FROM auth.sessions s
    WHERE s.id = v_session_id
      AND s.user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'SESSION_INVALID' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles actor
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
  v_deleted_lock_events integer := 0;
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
    SELECT 1
    FROM auth.sessions s
    WHERE s.id = v_session_id
      AND s.user_id = v_actor
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles actor
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

  SELECT g.id
  INTO v_grant_id
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
  WHERE id = v_grant_id
    AND consumed_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  UPDATE public.profiles
  SET
    locked_until = NULL,
    account_status = CASE WHEN account_status = 'LOCKED' THEN 'ACTIVE' ELSE account_status END,
    account_status_changed_at = CASE WHEN account_status = 'LOCKED' THEN now() ELSE account_status_changed_at END,
    account_status_changed_by = CASE WHEN account_status = 'LOCKED' THEN v_actor ELSE account_status_changed_by END,
    updated_at = now()
  WHERE user_id = p_user_id;

  -- auth_lock_events is the operational failure counter used by
  -- record_auth_failure. Clearing it is required for a real manual unlock;
  -- otherwise the next failed login can immediately lock the account again.
  DELETE FROM public.auth_lock_events
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_deleted_lock_events = ROW_COUNT;

  INSERT INTO public.security_audit_events (
    user_id,
    actor_user_id,
    event_type,
    event_category,
    severity,
    metadata,
    session_id,
    result
  ) VALUES (
    p_user_id,
    v_actor,
    'account_unlocked_by_security_admin',
    'account_lock',
    'info',
    jsonb_build_object(
      'previous_status', v_previous_status,
      'previous_locked_until', v_previous_locked_until,
      'cleared_lock_events', v_deleted_lock_events,
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
    'cleared_lock_events', v_deleted_lock_events
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
AS $$
  SELECT * FROM private.list_locked_accounts();
$$;

CREATE OR REPLACE FUNCTION public.security_admin_unlock_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.security_admin_unlock_account($1::uuid);
$$;

REVOKE ALL ON FUNCTION private.list_locked_accounts() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.security_admin_unlock_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_locked_accounts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.security_admin_unlock_account(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.list_locked_accounts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.security_admin_unlock_account(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
