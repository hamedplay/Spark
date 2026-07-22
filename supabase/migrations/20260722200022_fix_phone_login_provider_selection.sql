-- Independent RPC for selecting phone login SMS provider
-- Decoupled from set_phone_login_config (enable/disable)
-- Stores provider selection regardless of phone_login_enabled state

CREATE OR REPLACE FUNCTION public.set_phone_login_sms_provider(p_provider_id uuid)
RETURNS TABLE(success boolean, error text, provider_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid uuid;
  v_is_admin boolean := false;
  v_provider_active boolean := false;
  v_stored_provider_id uuid;
BEGIN
  -- 1. Auth check
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::text, NULL::uuid;
    RETURN;
  END IF;

  -- 2. Profile must exist and be active
  SELECT COALESCE(is_admin, false), COALESCE(is_active, false)
    INTO v_is_admin, v_provider_active
  FROM public.profiles
  WHERE user_id = v_caller_uid
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'PROFILE_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;

  IF NOT v_provider_active THEN
    RETURN QUERY SELECT false, 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;

  -- 3. Admin check
  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;

  -- 4. Validate provider if one is provided
  IF p_provider_id IS NOT NULL THEN
    BEGIN
      SELECT is_active INTO v_provider_active
      FROM public.sms_providers
      WHERE id = p_provider_id
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_provider_active := false;
    END;

    IF NOT FOUND OR NOT COALESCE(v_provider_active, false) THEN
      RETURN QUERY SELECT false, 'PROVIDER_NOT_READY'::text, NULL::uuid;
      RETURN;
    END IF;
  END IF;

  -- 5. Store provider selection (independent of phone_login_enabled)
  INSERT INTO public.system_config (
    section, key, value, value_type, label, description
  )
  VALUES (
    'sms', 'phone_login_sms_provider_id',
    p_provider_id::text,
    'string',
    'سرویس‌دهنده پیامک ورود موبایلی',
    'سرویس‌دهنده‌ای که برای ارسال کد ورود استفاده می‌شود'
  )
  ON CONFLICT (section, key)
  DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = now();

  -- 6. Return the stored provider_id
  v_stored_provider_id := CASE
    WHEN p_provider_id IS NULL THEN NULL
    ELSE p_provider_id
  END;

  RETURN QUERY SELECT true, NULL::text, v_stored_provider_id;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.set_phone_login_sms_provider(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_phone_login_sms_provider(uuid) TO authenticated;
