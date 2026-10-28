-- Only the user-facing notification implementation changes. The shared global
-- event-key index and trusted producers keep their existing key contract.
CREATE OR REPLACE FUNCTION private.create_notification(p_user_id uuid, p_title text, p_message text, p_type text, p_action_url text DEFAULT NULL::text, p_template_category text DEFAULT NULL::text, p_template_event_type text DEFAULT NULL::text, p_template_audience text DEFAULT NULL::text, p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_minute_id uuid DEFAULT NULL::uuid, p_revision_number integer DEFAULT NULL::integer, p_metadata jsonb DEFAULT NULL::jsonb, p_event_key text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_id uuid;
  v_created boolean := true;
  v_sender_name text;
  v_sender_avatar text;
  v_sender_org text;
  v_recipient_org text;
  v_recipient_active boolean;
  v_recipient_hidden boolean;
  v_rendered jsonb;
  v_title text := p_title;
  v_message text := p_message;
  v_template_id uuid;
  v_template_audience text := p_template_audience;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT private.is_current_session_fully_authorized() THEN
    RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED' USING ERRCODE='42501';
  END IF;

  SELECT full_name, avatar_url, organization
  INTO v_sender_name, v_sender_avatar, v_sender_org
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_sender_org IS NULL OR btrim(v_sender_org) = '' THEN
    RAISE EXCEPTION 'sender_organization_required';
  END IF;

  SELECT organization, COALESCE(is_active, false), COALESCE(is_hidden, false)
  INTO v_recipient_org, v_recipient_active, v_recipient_hidden
  FROM public.profiles
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_recipient_org IS NULL OR btrim(v_recipient_org) = '' THEN
    RAISE EXCEPTION 'recipient_not_found';
  END IF;
  IF v_recipient_active IS NOT TRUE THEN
    RAISE EXCEPTION 'recipient_not_active';
  END IF;
  IF v_recipient_hidden IS TRUE THEN
    RAISE EXCEPTION 'recipient_hidden';
  END IF;
  IF v_recipient_org <> v_sender_org THEN
    RAISE EXCEPTION 'recipient_outside_organization';
  END IF;

  IF p_template_category IS NOT NULL OR p_template_event_type IS NOT NULL OR p_template_audience IS NOT NULL THEN
    IF p_template_category IS NULL OR p_template_event_type IS NULL THEN
      RAISE EXCEPTION 'NOTIFICATION_TEMPLATE_ROUTE_INCOMPLETE' USING ERRCODE = 'P0001';
    END IF;

    v_rendered := private.render_notification_template(
      p_template_category,
      p_template_event_type,
      COALESCE(NULLIF(p_template_audience, ''), 'all'),
      COALESCE(p_metadata, '{}'::jsonb)
    );
    v_title := v_rendered->>'title';
    v_message := v_rendered->>'message';
    v_template_id := (v_rendered->>'template_id')::uuid;
    v_template_audience := v_rendered->>'audience';
  END IF;

  INSERT INTO public.notifications AS existing (
    user_id, title, message, type, read,
    sender_id, sender_name, sender_avatar_url, action_url,
    template_id, template_category, template_event_type, template_audience,
    entity_type, entity_id, minute_id, revision_number, metadata, event_key
  ) VALUES (
    p_user_id, v_title, v_message, p_type, false,
    auth.uid(), v_sender_name, v_sender_avatar, p_action_url,
    v_template_id, p_template_category, p_template_event_type, v_template_audience,
    p_entity_type, p_entity_id, p_minute_id, p_revision_number, p_metadata, p_event_key
  )
  ON CONFLICT (event_key) WHERE event_key IS NOT NULL
  DO UPDATE SET event_key = EXCLUDED.event_key
  WHERE existing.user_id = EXCLUDED.user_id
    AND existing.sender_id IS NOT DISTINCT FROM EXCLUDED.sender_id
  RETURNING existing.id, (existing.xmax = 0) AS was_inserted INTO v_id, v_created;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOTIFICATION_EVENT_KEY_CONFLICT' USING ERRCODE='23505';
  END IF;

  RETURN json_build_object(
    'notification_id', v_id,
    'created', v_created,
    'template_id', v_template_id,
    'template_audience', v_template_audience
  );
END;
$function$;
