-- Feature 2: allow meeting informees to add participants without granting meeting edit access.
-- This RPC is deliberately add-only. Existing organizer/admin participant sync remains unchanged.

CREATE OR REPLACE FUNCTION public.add_meeting_participant_as_informee(
  p_meeting_id uuid,
  p_participant_user_id uuid
)
RETURNS TABLE (
  added boolean,
  participant_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_organizer uuid;
  v_notify_users uuid[] := ARRAY[]::uuid[];
  v_participant_ids uuid[] := ARRAY[]::uuid[];
  v_caller_org text;
  v_caller_name text;
  v_target_org text;
  v_target_name text;
  v_target_active boolean;
  v_target_hidden boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT
    m.user_id,
    COALESCE(m.notify_users, ARRAY[]::uuid[]),
    COALESCE(m.participant_user_ids, ARRAY[]::uuid[])
  INTO
    v_organizer,
    v_notify_users,
    v_participant_ids
  FROM public.meetings AS m
  WHERE m.id = p_meeting_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEETING_NOT_FOUND';
  END IF;

  -- Only users explicitly listed as meeting informees receive this capability.
  IF NOT (v_caller = ANY(v_notify_users)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT
    COALESCE(p.organization, ''),
    COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.username), ''), v_caller::text)
  INTO
    v_caller_org,
    v_caller_name
  FROM public.profiles AS p
  WHERE p.user_id = v_caller
  LIMIT 1;

  IF NOT FOUND OR btrim(COALESCE(v_caller_org, '')) = '' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- The organizer is already intrinsically part of the meeting, and an informee
  -- may not promote themselves to participant through this restricted capability.
  IF p_participant_user_id IS NULL
     OR p_participant_user_id = v_organizer
     OR p_participant_user_id = v_caller THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT';
  END IF;

  SELECT
    COALESCE(p.organization, ''),
    COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.username), ''), p_participant_user_id::text),
    COALESCE(p.is_active, false),
    COALESCE(p.is_hidden, false)
  INTO
    v_target_org,
    v_target_name,
    v_target_active,
    v_target_hidden
  FROM public.profiles AS p
  WHERE p.user_id = p_participant_user_id
  LIMIT 1;

  IF NOT FOUND OR v_target_active IS NOT TRUE OR v_target_hidden IS TRUE THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT';
  END IF;

  IF v_target_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'CROSS_ORG_PARTICIPANT';
  END IF;

  -- Idempotent: adding an existing participant is a no-op and creates no audit row.
  IF p_participant_user_id = ANY(v_participant_ids) THEN
    RETURN QUERY SELECT false, p_participant_user_id;
    RETURN;
  END IF;

  UPDATE public.meetings AS m
  SET participant_user_ids = array_append(v_participant_ids, p_participant_user_id)
  WHERE m.id = p_meeting_id;

  -- Existing meetings_sync_inbox_from_participants trigger creates the standard
  -- pending invitation for scheduled meetings. No parallel invitation path is added.
  INSERT INTO public.audit_log (
    user_id,
    user_name,
    module,
    entity_name,
    action,
    details,
    severity,
    entity_id
  )
  VALUES (
    v_caller,
    v_caller_name,
    'meetings',
    'meeting_participant',
    'INFORMEE_ADD_PARTICIPANT',
    jsonb_build_object(
      'meeting_id', p_meeting_id,
      'added_by_user_id', v_caller,
      'added_by_name', v_caller_name,
      'added_participant_user_id', p_participant_user_id,
      'added_participant_name', v_target_name,
      'source', 'notify_user'
    )::text,
    'info',
    p_meeting_id::text
  );

  RETURN QUERY SELECT true, p_participant_user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_meeting_participant_as_informee(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_meeting_participant_as_informee(uuid, uuid) TO authenticated;
