-- Fix: PL/pgSQL RETURNS TABLE(meeting_id uuid, ...) creates a variable that shadows
-- the meeting_id column in INSERT...ON CONFLICT clauses, causing "column reference
-- is ambiguous" errors. Use EXECUTE with parameters to avoid variable resolution.

CREATE OR REPLACE FUNCTION public.sync_meeting_participants_v2(
  p_meeting_id uuid,
  p_participant_user_ids uuid[]
)
RETURNS TABLE(
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

  SELECT m.user_id INTO v_organizer
  FROM public.meetings AS m
  WHERE m.id = p_meeting_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEETING_NOT_FOUND';
  END IF;

  IF v_organizer IS DISTINCT FROM v_caller AND NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT COALESCE(p.organization, '') INTO v_caller_org
  FROM public.profiles AS p
  WHERE p.user_id = v_caller
  LIMIT 1;

  IF v_caller_org IS NULL OR btrim(v_caller_org) = '' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT COALESCE(m.participant_user_ids, ARRAY[]::uuid[]) INTO v_previous_ids
  FROM public.meetings AS m
  WHERE m.id = p_meeting_id;

  v_previous_ids := ARRAY(
    SELECT DISTINCT x FROM unnest(v_previous_ids) AS t(x)
    WHERE x IS NOT NULL AND x <> v_organizer
  );

  v_next_ids := ARRAY(
    SELECT DISTINCT x FROM unnest(COALESCE(p_participant_user_ids, ARRAY[]::uuid[])) AS t(x)
    WHERE x IS NOT NULL AND x <> v_organizer
  );

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

  v_added_ids := ARRAY(
    SELECT x FROM unnest(v_next_ids) AS t(x)
    EXCEPT
    SELECT x FROM unnest(v_previous_ids) AS t(x)
  );
  v_retained_ids := ARRAY(
    SELECT x FROM unnest(v_next_ids) AS t(x)
    INTERSECT
    SELECT x FROM unnest(v_previous_ids) AS t(x)
  );
  v_removed_ids := ARRAY(
    SELECT x FROM unnest(v_previous_ids) AS t(x)
    EXCEPT
    SELECT x FROM unnest(v_next_ids) AS t(x)
  );

  UPDATE public.meetings AS m
  SET participant_user_ids = p_participant_user_ids
  WHERE m.id = p_meeting_id;

  IF array_length(v_removed_ids, 1) > 0 THEN
    DELETE FROM public.meeting_inbox AS mi
    WHERE mi.meeting_id = p_meeting_id
      AND mi.user_id = ANY(v_removed_ids);
  END IF;

  IF array_length(v_added_ids, 1) > 0 THEN
    EXECUTE 'INSERT INTO public.meeting_inbox (meeting_id, user_id, status) SELECT $1, u.id, ''pending'' FROM unnest($2) AS u(id) ON CONFLICT (meeting_id, user_id) DO UPDATE SET status = EXCLUDED.status'
    USING p_meeting_id, v_added_ids;
  END IF;

  RETURN QUERY
  SELECT
    p_meeting_id,
    COALESCE(v_added_ids, ARRAY[]::uuid[]),
    COALESCE(v_retained_ids, ARRAY[]::uuid[]),
    COALESCE(v_removed_ids, ARRAY[]::uuid[]);
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_meeting_participants_v2(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_meeting_participants_v2(uuid, uuid[]) TO authenticated;


CREATE OR REPLACE FUNCTION public.sync_meeting_participants_bulk_v2(
  p_meeting_ids uuid[],
  p_participant_user_ids uuid[]
)
RETURNS TABLE(
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
  v_meeting_id uuid;
  v_organizer uuid;
  v_next_ids uuid[];
  v_previous_ids uuid[];
  v_added_ids uuid[];
  v_retained_ids uuid[];
  v_removed_ids uuid[];
  v_invalid_id uuid;
  v_cross_org_id uuid;
  v_inactive_id uuid;
  v_hidden_id uuid;
  v_unauthorized_id uuid;
  v_caller_org text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF array_length(COALESCE(p_meeting_ids, ARRAY[]::uuid[]), 1) IS NULL THEN
    RAISE EXCEPTION 'MEETING_NOT_FOUND';
  END IF;

  SELECT COALESCE(p.organization, '') INTO v_caller_org
  FROM public.profiles AS p
  WHERE p.user_id = v_caller
  LIMIT 1;

  IF v_caller_org IS NULL OR btrim(v_caller_org) = '' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_next_ids := ARRAY(
    SELECT DISTINCT x FROM unnest(COALESCE(p_participant_user_ids, ARRAY[]::uuid[])) AS t(x)
    WHERE x IS NOT NULL
  );

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

  SELECT m.id INTO v_unauthorized_id
  FROM public.meetings AS m
  WHERE m.id = ANY(p_meeting_ids)
    AND m.user_id IS DISTINCT FROM v_caller
    AND NOT public.is_current_user_admin()
  LIMIT 1;

  IF v_unauthorized_id IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF (SELECT count(DISTINCT m.id) FROM public.meetings AS m WHERE m.id = ANY(p_meeting_ids))
     <> array_length(p_meeting_ids, 1) THEN
    RAISE EXCEPTION 'MEETING_NOT_FOUND';
  END IF;

  FOREACH v_meeting_id IN ARRAY p_meeting_ids LOOP
    SELECT m.user_id INTO v_organizer FROM public.meetings AS m WHERE m.id = v_meeting_id FOR UPDATE;

    SELECT COALESCE(m.participant_user_ids, ARRAY[]::uuid[]) INTO v_previous_ids
    FROM public.meetings AS m
    WHERE m.id = v_meeting_id;

    v_previous_ids := ARRAY(
      SELECT DISTINCT x FROM unnest(v_previous_ids) AS t(x)
      WHERE x IS NOT NULL AND x <> v_organizer
    );

    v_added_ids := ARRAY(
      SELECT x FROM unnest(v_next_ids) AS t(x)
      EXCEPT
      SELECT x FROM unnest(v_previous_ids) AS t(x)
    );
    v_retained_ids := ARRAY(
      SELECT x FROM unnest(v_next_ids) AS t(x)
      INTERSECT
      SELECT x FROM unnest(v_previous_ids) AS t(x)
    );
    v_removed_ids := ARRAY(
      SELECT x FROM unnest(v_previous_ids) AS t(x)
      EXCEPT
      SELECT x FROM unnest(v_next_ids) AS t(x)
    );

    UPDATE public.meetings AS m
    SET participant_user_ids = p_participant_user_ids
    WHERE m.id = v_meeting_id;

    IF array_length(v_removed_ids, 1) > 0 THEN
      DELETE FROM public.meeting_inbox AS mi
      WHERE mi.meeting_id = v_meeting_id
        AND mi.user_id = ANY(v_removed_ids);
    END IF;

    IF array_length(v_added_ids, 1) > 0 THEN
      EXECUTE 'INSERT INTO public.meeting_inbox (meeting_id, user_id, status) SELECT $1, u.id, ''pending'' FROM unnest($2) AS u(id) ON CONFLICT (meeting_id, user_id) DO UPDATE SET status = EXCLUDED.status'
      USING v_meeting_id, v_added_ids;
    END IF;

    RETURN QUERY
    SELECT
      v_meeting_id,
      COALESCE(v_added_ids, ARRAY[]::uuid[]),
      COALESCE(v_retained_ids, ARRAY[]::uuid[]),
      COALESCE(v_removed_ids, ARRAY[]::uuid[]);
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_meeting_participants_bulk_v2(uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_meeting_participants_bulk_v2(uuid[], uuid[]) TO authenticated;