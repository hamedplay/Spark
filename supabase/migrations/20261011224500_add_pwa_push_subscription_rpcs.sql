CREATE OR REPLACE FUNCTION public.upsert_my_pwa_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING errcode = '42501';
  END IF;
  IF nullif(btrim(p_endpoint), '') IS NULL
     OR length(p_endpoint) > 4096
     OR nullif(btrim(p_p256dh), '') IS NULL
     OR nullif(btrim(p_auth_key), '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION' USING errcode = '22023';
  END IF;

  INSERT INTO public.pwa_push_subscriptions(
    user_id, endpoint, p256dh, auth_key, user_agent,
    updated_at, disabled_at, failure_count
  )
  VALUES (
    v_user_id, p_endpoint, p_p256dh, p_auth_key,
    left(p_user_agent, 500), now(), NULL, 0
  )
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        p256dh = EXCLUDED.p256dh,
        auth_key = EXCLUDED.auth_key,
        user_agent = EXCLUDED.user_agent,
        updated_at = now(),
        disabled_at = NULL,
        failure_count = 0
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_my_pwa_push_subscription(text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_my_pwa_push_subscription(text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.disable_my_pwa_push_subscription(p_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING errcode = '42501';
  END IF;

  UPDATE public.pwa_push_subscriptions
  SET disabled_at = now(), updated_at = now()
  WHERE endpoint = p_endpoint
    AND user_id = auth.uid();
END;
$function$;

REVOKE ALL ON FUNCTION public.disable_my_pwa_push_subscription(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disable_my_pwa_push_subscription(text) TO authenticated;
