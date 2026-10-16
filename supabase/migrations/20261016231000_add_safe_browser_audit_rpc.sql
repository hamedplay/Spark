-- Route browser audit writes through a narrow SECURITY DEFINER RPC so audit
-- logging does not depend on direct table RLS and client-side IP services.

CREATE OR REPLACE FUNCTION public.write_audit_log(
  p_module text,
  p_action text,
  p_entity_name text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_details text DEFAULT NULL,
  p_severity text DEFAULT 'info',
  p_user_agent text DEFAULT NULL,
  p_url text DEFAULT NULL,
  p_referrer text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
  v_headers jsonb := '{}'::jsonb;
  v_ip text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(COALESCE(p_action, '')), '') IS NULL THEN
    RAISE EXCEPTION 'AUDIT_ACTION_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_severity, 'info') NOT IN ('info', 'warning', 'error', 'critical') THEN
    RAISE EXCEPTION 'INVALID_AUDIT_SEVERITY' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), NULLIF(btrim(email), ''))
  INTO v_user_name
  FROM public.profiles
  WHERE user_id = v_uid
  LIMIT 1;

  BEGIN
    v_headers := COALESCE(NULLIF(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  EXCEPTION WHEN others THEN
    v_headers := '{}'::jsonb;
  END;

  v_ip := NULLIF(btrim(split_part(
    COALESCE(v_headers->>'x-forwarded-for', v_headers->>'x-real-ip', ''),
    ',',
    1
  )), '');

  INSERT INTO public.audit_log (
    user_id,
    user_name,
    ip_address,
    user_agent,
    module,
    action,
    entity_name,
    entity_id,
    details,
    severity,
    url,
    referrer
  ) VALUES (
    v_uid,
    v_user_name,
    v_ip,
    p_user_agent,
    p_module,
    p_action,
    p_entity_name,
    p_entity_id,
    p_details,
    COALESCE(p_severity, 'info'),
    p_url,
    p_referrer
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

INSERT INTO private.security_definer_rpc_acl_allowlist
  (signature, allow_authenticated, allow_anon, rationale)
VALUES
  (
    'public.write_audit_log(text,text,text,text,text,text,text,text,text)',
    true,
    false,
    'Authenticated self-scoped audit writer; derives actor and client IP server-side and does not accept a user_id.'
  )
ON CONFLICT (signature) DO UPDATE
SET allow_authenticated = EXCLUDED.allow_authenticated,
    allow_anon = EXCLUDED.allow_anon,
    rationale = EXCLUDED.rationale,
    updated_at = now();

SELECT private.apply_public_security_definer_acl_policy();
