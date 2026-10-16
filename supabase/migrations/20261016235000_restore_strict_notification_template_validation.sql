-- Restore strict notification-template context validation.
--
-- The previous runtime-stabilization migration auto-filled every declared
-- placeholder missing from p_context with an empty string. That could hide
-- broken callers and produce incomplete notifications. Keep the existing
-- template routing/date-formatting behavior, but require callers to provide
-- every placeholder actually referenced by the selected template.

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
