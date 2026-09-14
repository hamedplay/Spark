-- Store progressive lock schedule values in minutes while preserving existing durations.
UPDATE public.auth_security_settings s
SET progressive_lock_schedule = ARRAY(
  SELECT (entry::integer * 60)::text
  FROM unnest(s.progressive_lock_schedule) WITH ORDINALITY AS u(entry, ord)
  ORDER BY ord
)
WHERE COALESCE(array_length(s.progressive_lock_schedule, 1), 0) BETWEEN 1 AND 12
  AND NOT EXISTS (
    SELECT 1 FROM unnest(s.progressive_lock_schedule) AS entry
    WHERE entry !~ '^[0-9]+$' OR entry::integer < 1 OR entry::integer > 720
  );

ALTER TABLE public.auth_security_settings
  ALTER COLUMN progressive_lock_schedule
  SET DEFAULT ARRAY['60','360','720','1440','2880','4320']::text[];

-- Keep server-side settings validation aligned with the minute-based contract.
DO $migration$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'set_auth_security_settings_patch'
    AND pg_get_function_identity_arguments(p.oid) = 'p_expected_version integer, p_patch jsonb, p_change_reason text';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'private.set_auth_security_settings_patch not found';
  END IF;

  IF position('entry::integer > 720' in v_def) = 0 THEN
    RAISE EXCEPTION 'expected progressive schedule validation was not found';
  END IF;

  v_def := replace(v_def, 'entry::integer > 720', 'entry::integer > 43200');
  EXECUTE v_def;
END
$migration$;

CREATE OR REPLACE FUNCTION public.record_auth_failure(p_user_id uuid, p_identifier_hash text, p_ip_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_progressive_enabled boolean := false;
  v_recent_failures integer;
  v_threshold integer := 5;
  v_fixed_lock_minutes integer := 30;
  v_schedule text[] := ARRAY['60','360','720','1440','2880','4320']::text[];
  v_current_lock_level integer;
  v_new_lock_level integer;
  v_lock_minutes integer;
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
    COALESCE(progressive_lock_schedule, ARRAY['60','360','720','1440','2880','4320']::text[])
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
         WHEN entry ~ '^[0-9]+$' THEN entry::integer < 1 OR entry::integer > 43200
         ELSE true
       END
     ) THEN
    v_schedule := ARRAY['60','360','720','1440','2880','4320']::text[];
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

  -- Once the last configured level is reached, keep using that level/duration.
  v_new_lock_level := LEAST(v_current_lock_level + 1, v_schedule_len);
  v_lock_minutes := v_schedule[v_new_lock_level]::integer;
  v_locked_until := now() + make_interval(mins => v_lock_minutes);

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
    'lock_minutes', v_lock_minutes
  );
END;
$function$;
