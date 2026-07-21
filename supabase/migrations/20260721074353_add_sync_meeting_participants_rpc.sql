-- Atomic, backend-secure participant sync for meeting edits.
-- Additive migration: new RPC only. Does not touch existing migrations, RLS, profiles, or get_selectable_users_v2.
-- Reuses existing UNIQUE(meeting_id,user_id) constraint on meeting_inbox.

CREATE OR REPLACE FUNCTION public.sync_meeting_participants_v2(
  p_meeting_id uuid,
  p_participant_user_ids uuid[]
)
RETURNS TABLE (
  meeting_id uuid,
  added_participant_ids uuid[],
  retained_participant_ids uuid[],
  removed_participant_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_organizer uuid;
  v_previous_ids uuid[];
  v_next_ids uuid[];
  v_added_ids uuid[];
  v_retained_ids uuid[];
  v_removed_ids uuid[];
  v_invalid_id uuid;
  v_cross_org_id uuid;
  v_inactive_id uuid;
  v_hidden_id uuid;
  v_caller_org text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Caller must be organizer or admin
  SELECT m.user_id INTO v_organizer
  FROM public.meetings AS m
  WHERE m.id = p_meeting_id
  FOR UPDATE;  -- row lock prevents concurrent edit races

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEETING_NOT_FOUND';
  END IF;

  IF v_organizer IS DISTINCT FROM v_caller AND NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Caller organization for tenant validation
  SELECT COALESCE(p.organization, '') INTO v_caller_org
  FROM public.profiles AS p
  WHERE p.user_id = v_caller
  LIMIT 1;

  IF v_caller_org IS NULL OR btrim(v_caller_org) = '' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Previous participants (excluding organizer, matching create-flow convention)
  SELECT COALESCE(m.participant_user_ids, ARRAY[]::uuid[]) INTO v_previous_ids
  FROM public.meetings AS m
  WHERE m.id = p_meeting_id;

  v_previous_ids := ARRAY(
    SELECT DISTINCT unnest(v_previous_ids)
    WHERE unnest IS NOT NULL
      AND unnest <> v_organizer
  );

  -- Deduplicate next participants (excluding organizer)
  v_next_ids := ARRAY(
    SELECT DISTINCT unnest(COALESCE(p_participant_user_ids, ARRAY[]::uuid[]))
    WHERE unnest IS NOT NULL
      AND unnest <> v_organizer
  );

  -- Validate added participants: must exist, same org, active, not hidden
  SELECT u.id INTO v_invalid_id
  FROM unnest(v_next_ids) AS u(id)
  LEFT JOIN public.profiles AS p ON p.user_id = u.id
  WHERE p.user_id IS NULL
  LIMIT 1;

  IF v_invalid_id IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT';
  END IF;

  SELECT u.id INTO v_cross_org_id
  FROM unnest(v_next_ids) AS u(id)
  JOIN public.profiles AS p ON p.user_id = u.id
  WHERE COALESCE(p.organization, '') IS DISTINCT FROM v_caller_org
  LIMIT 1;

  IF v_cross_org_id IS NOT NULL THEN
    RAISE EXCEPTION 'CROSS_ORG_PARTICIPANT';
  END IF;

  SELECT u.id INTO v_inactive_id
  FROM unnest(v_next_ids) AS u(id)
  JOIN public.profiles AS p ON p.user_id = u.id
  WHERE COALESCE(p.is_active, false) IS NOT TRUE
  LIMIT 1;

  IF v_inactive_id IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT';
  END IF;

  SELECT u.id INTO v_hidden_id
  FROM unnest(v_next_ids) AS u(id)
  JOIN public.profiles AS p ON p.user_id = u.id
  WHERE COALESCE(p.is_hidden, false) IS TRUE
  LIMIT 1;

  IF v_hidden_id IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT';
  END IF;

  -- Compute diff
  v_added_ids := ARRAY(SELECT unnest(v_next_ids) EXCEPT SELECT unnest(v_previous_ids));
  v_retained_ids := ARRAY(SELECT unnest(v_next_ids) INTERSECT SELECT unnest(v_previous_ids));
  v_removed_ids := ARRAY(SELECT unnest(v_previous_ids) EXCEPT SELECT unnest(v_next_ids));

  -- Update participant_user_ids (includes organizer if present in input, matching create-flow behavior)
  UPDATE public.meetings AS m
  SET participant_user_ids = p_participant_user_ids
  WHERE m.id = p_meeting_id;

  -- Sync meeting_inbox: delete removed (any status), insert pending for added
  IF array_length(v_removed_ids, 1) > 0 THEN
    DELETE FROM public.meeting_inbox AS mi
    WHERE mi.meeting_id = p_meeting_id
      AND mi.user_id = ANY(v_removed_ids);
  END IF;

  IF array_length(v_added_ids, 1) > 0 THEN
    INSERT INTO public.meeting_inbox (meeting_id, user_id, status)
    SELECT p_meeting_id, u.id, 'pending'
    FROM unnest(v_added_ids) AS u(id)
    ON CONFLICT (meeting_id, user_id) DO UPDATE SET status = EXCLUDED.status;
  END IF;

  RETURN QUERY
  SELECT
    p_meeting_id,
    COALESCE(v_added_ids, ARRAY[]::uuid[]),
    COALESCE(v_retained_ids, ARRAY[]::uuid[]),
    COALESCE(v_removed_ids, ARRAY[]::uuid[]);
END;
$function$;

-- Revoke public/anon access; only authenticated may call
REVOKE ALL ON FUNCTION public.sync_meeting_participants_v2(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_meeting_participants_v2(uuid, uuid[]) TO authenticated;