-- Stabilize browser-facing notification rendering and management reporting after ACL hardening.

CREATE OR REPLACE FUNCTION private.render_notification_template(
  p_category text,
  p_event_type text,
  p_audience text DEFAULT 'all'::text,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_template public.notification_templates%ROWTYPE;
  v_title text;
  v_message text;
  v_context jsonb := COALESCE(p_context, '{}'::jsonb);
  v_key text;
  v_value text;
  v_unresolved text[] := ARRAY[]::text[];
  v_match text[];
  v_declared_key text;
  v_date_keys constant text[] := ARRAY['meeting_date','event_date','due_date','decision_due_date','followup_date'];
BEGIN
  IF NULLIF(btrim(p_category), '') IS NULL OR NULLIF(btrim(p_event_type), '') IS NULL THEN
    RAISE EXCEPTION 'NOTIFICATION_TEMPLATE_ROUTE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_template
  FROM public.notification_templates
  WHERE category = p_category
    AND event_type = p_event_type
    AND audience = COALESCE(NULLIF(p_audience, ''), 'all')
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND AND COALESCE(NULLIF(p_audience, ''), 'all') <> 'all' THEN
    SELECT * INTO v_template
    FROM public.notification_templates
    WHERE category = p_category
      AND event_type = p_event_type
      AND audience = 'all'
      AND is_active = true
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOTIFICATION_TEMPLATE_NOT_FOUND:%/%/%',
      p_category, p_event_type, COALESCE(NULLIF(p_audience, ''), 'all')
      USING ERRCODE = 'P0001';
  END IF;

  -- Declared template placeholders are presentation fields. Missing values
  -- default to empty strings so a valid notification cannot fail only because
  -- one optional display field is absent. Undeclared placeholders still fail
  -- closed below, preserving template integrity checks.
  FOREACH v_declared_key IN ARRAY COALESCE(v_template.placeholders, ARRAY[]::text[])
  LOOP
    IF NOT (v_context ? v_declared_key) THEN
      v_context := v_context || jsonb_build_object(v_declared_key, '');
    END IF;
  END LOOP;

  v_title := COALESCE(v_template.title, '');
  v_message := COALESCE(v_template.body, '');

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each_text(v_context) LOOP
    IF v_key = ANY(v_date_keys) THEN
      v_value := private.jalali_template_date_text(v_value);
    END IF;

    v_title := replace(v_title, '{{' || v_key || '}}', COALESCE(v_value, ''));
    v_message := replace(v_message, '{{' || v_key || '}}', COALESCE(v_value, ''));
    v_title := replace(v_title, '{' || v_key || '}', COALESCE(v_value, ''));
    v_message := replace(v_message, '{' || v_key || '}', COALESCE(v_value, ''));
  END LOOP;

  FOR v_match IN
    SELECT regexp_matches(v_title || E'\n' || v_message, '\{\{([a-zA-Z0-9_]+)\}\}', 'g')
  LOOP
    IF NOT (v_match[1] = ANY(v_unresolved)) THEN
      v_unresolved := array_append(v_unresolved, v_match[1]);
    END IF;
  END LOOP;

  FOR v_match IN
    SELECT regexp_matches(v_title || E'\n' || v_message, '(?<!\{)\{([a-zA-Z0-9_]+)\}(?!\})', 'g')
  LOOP
    IF NOT (v_match[1] = ANY(v_unresolved)) THEN
      v_unresolved := array_append(v_unresolved, v_match[1]);
    END IF;
  END LOOP;

  IF COALESCE(array_length(v_unresolved, 1), 0) > 0 THEN
    RAISE EXCEPTION 'NOTIFICATION_TEMPLATE_CONTEXT_MISSING:%', array_to_string(v_unresolved, ',')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'template_id', v_template.id,
    'title', v_title,
    'message', v_message,
    'audience', v_template.audience
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_manager_minutes_decision_report(
  p_decision_id uuid,
  p_expected_updated_at timestamptz,
  p_report_text text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_current_session_fully_authorized() THEN
    RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED' USING ERRCODE = '42501';
  END IF;

  RETURN private.record_manager_minutes_decision_report(
    p_decision_id,
    p_expected_updated_at,
    p_report_text
  );
END;
$function$;

INSERT INTO private.security_definer_rpc_acl_allowlist
  (signature, allow_authenticated, allow_anon, rationale)
VALUES
  (
    'public.record_manager_minutes_decision_report(uuid,timestamp with time zone,text)',
    true,
    false,
    'Manager minutes reporting RPC used directly by the authenticated UI; wrapper enforces a fully authorized session and private implementation enforces actor authorization.'
  )
ON CONFLICT (signature) DO UPDATE
SET allow_authenticated = EXCLUDED.allow_authenticated,
    allow_anon = EXCLUDED.allow_anon,
    rationale = EXCLUDED.rationale,
    updated_at = now();

SELECT private.apply_public_security_definer_acl_policy();
