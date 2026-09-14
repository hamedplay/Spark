BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.set_maintenance_mode(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_previous_value text;
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

  IF NOT private.is_current_session_fully_authorized() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FULLY_AUTHORIZED');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = v_actor
      AND p.is_admin IS TRUE
      AND p.is_active IS TRUE
      AND p.account_status = 'ACTIVE'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ADMIN_REQUIRED');
  END IF;

  SELECT sc.value
  INTO v_previous_value
  FROM public.system_config sc
  WHERE sc.section = 'security'
    AND sc.key = 'maintenance_mode'
  FOR UPDATE;

  INSERT INTO public.system_config (
    section,
    key,
    value,
    value_type,
    label,
    description,
    updated_by,
    updated_at
  ) VALUES (
    'security',
    'maintenance_mode',
    CASE WHEN p_enabled THEN 'true' ELSE 'false' END,
    'boolean',
    'حالت تعمیر و نگهداری',
    'در صورت فعال بودن، کاربران عادی از پوسته سامانه خارج می‌شوند و فقط مدیران سامانه دسترسی دارند.',
    v_actor,
    now()
  )
  ON CONFLICT (section, key) DO UPDATE
  SET value = EXCLUDED.value,
      value_type = 'boolean',
      label = COALESCE(public.system_config.label, EXCLUDED.label),
      description = COALESCE(public.system_config.description, EXCLUDED.description),
      updated_by = v_actor,
      updated_at = now();

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
    v_actor,
    v_actor,
    'maintenance_mode_changed',
    'settings_change',
    'warning',
    jsonb_build_object(
      'previous_value', v_previous_value,
      'enabled', p_enabled
    ),
    v_session_id,
    'success'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'enabled', p_enabled,
    'previous_value', v_previous_value
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_maintenance_mode(p_enabled boolean)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.set_maintenance_mode($1);
$$;

REVOKE ALL ON FUNCTION private.set_maintenance_mode(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_maintenance_mode(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_maintenance_mode(boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
