/*
# Make create_notification idempotent on event_key conflicts

1. Purpose
   - When `p_event_key` is provided and a notification with that key already exists,
     the function now returns the existing notification's id instead of raising
     a unique-violation exception.
   - This makes double-click, browser retry, and network retry scenarios safe:
     the second call is a no-op that returns the existing notification id.
   - No existing behavior changes when `p_event_key` is NULL (the default).

2. Changes
   - `create_notification` function body: INSERT now uses
     `ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO UPDATE SET
     event_key = EXCLUDED.event_key RETURNING id`
     to handle the partial unique index gracefully.
   - The function is replaced with `CREATE OR REPLACE`, which is safe and additive.

3. Security
   - No RLS or policy changes. The function remains SECURITY DEFINER with empty search_path.
   - The idempotency check is server-side and cannot be bypassed by the client.

4. Rollback
   - Recreate the previous version of create_notification without the ON CONFLICT clause.
*/

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text,
  p_action_url text DEFAULT NULL::text,
  p_template_category text DEFAULT NULL::text,
  p_template_event_type text DEFAULT NULL::text,
  p_template_audience text DEFAULT NULL::text,
  p_entity_type text DEFAULT NULL::text,
  p_entity_id uuid DEFAULT NULL::uuid,
  p_minute_id uuid DEFAULT NULL::uuid,
  p_revision_number integer DEFAULT NULL::integer,
  p_metadata jsonb DEFAULT NULL::jsonb,
  p_event_key text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
  v_sender_name text;
  v_sender_avatar text;
  v_sender_org text;
  v_recipient_org text;
  v_recipient_active boolean;
  v_recipient_hidden boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Sender identity is resolved server-side (cannot be spoofed by client).
  SELECT full_name, avatar_url, organization
  INTO v_sender_name, v_sender_avatar, v_sender_org
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  -- Sender must have a concrete organization.
  IF v_sender_org IS NULL OR btrim(v_sender_org) = '' THEN
    RAISE EXCEPTION 'sender_organization_required';
  END IF;

  -- Recipient must exist, be active, not hidden, and share the sender's
  -- exact organization. NULL/empty recipient organization is rejected.
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

  INSERT INTO public.notifications (
    user_id, title, message, type, read,
    sender_id, sender_name, sender_avatar_url, action_url,
    template_category, template_event_type, template_audience,
    entity_type, entity_id, minute_id, revision_number, metadata, event_key
  ) VALUES (
    p_user_id, p_title, p_message, p_type, false,
    auth.uid(), v_sender_name, v_sender_avatar, p_action_url,
    p_template_category, p_template_event_type, p_template_audience,
    p_entity_type, p_entity_id, p_minute_id, p_revision_number, p_metadata, p_event_key
  )
  ON CONFLICT (event_key) WHERE event_key IS NOT NULL
  DO UPDATE SET event_key = EXCLUDED.event_key
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;