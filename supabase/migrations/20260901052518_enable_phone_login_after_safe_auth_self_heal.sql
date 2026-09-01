DO $$
DECLARE
  v_provider_id text;
  v_provider_active boolean := false;
  v_template_ready boolean := false;
  v_backend_ready boolean := false;
  v_origins text;
  v_ttl integer;
  v_resend integer;
  v_max_attempts integer;
  v_rows integer;
BEGIN
  SELECT value
  INTO v_provider_id
  FROM public.system_config
  WHERE section = 'sms'
    AND key = 'phone_login_sms_provider_id'
  LIMIT 1;

  IF v_provider_id IS NOT NULL THEN
    BEGIN
      SELECT COALESCE(is_active, false)
      INTO v_provider_active
      FROM public.sms_providers
      WHERE id = v_provider_id::uuid
      LIMIT 1;
    EXCEPTION WHEN invalid_text_representation THEN
      v_provider_active := false;
    END;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.sms_templates
    WHERE category = 'auth'
      AND event_type = 'login_otp'
      AND audience = 'all'
      AND is_active = true
      AND body LIKE '%{{otp}}%'
  )
  INTO v_template_ready;

  SELECT COALESCE(value = 'true', false)
  INTO v_backend_ready
  FROM public.system_config
  WHERE section = 'security'
    AND key = 'phone_otp_login_backend_ready'
  LIMIT 1;

  SELECT value
  INTO v_origins
  FROM public.system_config
  WHERE section = 'security'
    AND key = 'phone_login_allowed_origins'
  LIMIT 1;

  SELECT value::integer
  INTO v_ttl
  FROM public.system_config
  WHERE section = 'security'
    AND key = 'phone_otp_login_ttl_seconds'
  LIMIT 1;

  SELECT value::integer
  INTO v_resend
  FROM public.system_config
  WHERE section = 'security'
    AND key = 'phone_otp_login_resend_seconds'
  LIMIT 1;

  SELECT value::integer
  INTO v_max_attempts
  FROM public.system_config
  WHERE section = 'security'
    AND key = 'phone_otp_login_max_attempts'
  LIMIT 1;

  IF NOT v_backend_ready
     OR NOT v_provider_active
     OR NOT v_template_ready
     OR v_origins IS NULL
     OR btrim(v_origins) = ''
     OR v_ttl NOT BETWEEN 60 AND 300
     OR v_resend NOT BETWEEN 30 AND 300
     OR v_resend > v_ttl
     OR v_max_attempts NOT BETWEEN 3 AND 10
  THEN
    RAISE EXCEPTION 'PHONE_LOGIN_PRECONDITIONS_NOT_READY';
  END IF;

  UPDATE public.system_config
  SET value = 'true',
      updated_at = now()
  WHERE section = 'security'
    AND key = 'phone_login_canonical_enabled';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'PHONE_LOGIN_CANONICAL_FLAG_ROW_COUNT_%', v_rows;
  END IF;
END
$$;
