CREATE OR REPLACE FUNCTION private.sync_meeting_inbox_from_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_old_ids uuid[] := ARRAY[]::uuid[];
  v_new_ids uuid[] := ARRAY[]::uuid[];
  v_added uuid[] := ARRAY[]::uuid[];
  v_removed uuid[] := ARRAY[]::uuid[];
  v_old_is_scheduled boolean := false;
  v_new_is_scheduled boolean := false;
BEGIN
  v_new_is_scheduled :=
    NULLIF(btrim(NEW.start_time), '') IS NOT NULL
    AND NULLIF(btrim(NEW.end_time), '') IS NOT NULL;

  IF TG_OP = 'UPDATE' THEN
    v_old_is_scheduled :=
      NULLIF(btrim(OLD.start_time), '') IS NOT NULL
      AND NULLIF(btrim(OLD.end_time), '') IS NOT NULL;
  END IF;

  -- Meeting requests are not calendar invitations until a real start/end time
  -- has been assigned. Remove any stale inbox rows while the meeting is
  -- unscheduled.
  IF NOT v_new_is_scheduled THEN
    DELETE FROM public.meeting_inbox
    WHERE meeting_id = NEW.id;

    RETURN NEW;
  END IF;

  -- An unscheduled request has no active calendar recipients. When it is first
  -- scheduled, all current participants must therefore be treated as added.
  IF TG_OP = 'UPDATE' AND v_old_is_scheduled THEN
    v_old_ids := ARRAY(
      SELECT DISTINCT x
      FROM unnest(COALESCE(OLD.participant_user_ids, ARRAY[]::uuid[])) AS t(x)
      WHERE x IS NOT NULL
        AND x IS DISTINCT FROM OLD.user_id
    );
  END IF;

  v_new_ids := ARRAY(
    SELECT DISTINCT x
    FROM unnest(COALESCE(NEW.participant_user_ids, ARRAY[]::uuid[])) AS t(x)
    WHERE x IS NOT NULL
      AND x IS DISTINCT FROM NEW.user_id
  );

  v_added := ARRAY(
    SELECT x FROM unnest(v_new_ids) AS t(x)
    EXCEPT
    SELECT x FROM unnest(v_old_ids) AS t(x)
  );

  v_removed := ARRAY(
    SELECT x FROM unnest(v_old_ids) AS t(x)
    EXCEPT
    SELECT x FROM unnest(v_new_ids) AS t(x)
  );

  IF array_length(v_removed, 1) > 0 THEN
    DELETE FROM public.meeting_inbox
    WHERE meeting_id = NEW.id
      AND user_id = ANY(v_removed);
  END IF;

  IF array_length(v_added, 1) > 0 THEN
    INSERT INTO public.meeting_inbox (meeting_id, user_id, status)
    SELECT NEW.id, x, 'pending'
    FROM unnest(v_added) AS t(x)
    ON CONFLICT (meeting_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- Remove inbox rows already created for unscheduled meeting requests.
DELETE FROM public.meeting_inbox AS mi
USING public.meetings AS m
WHERE m.id = mi.meeting_id
  AND (
    NULLIF(btrim(m.start_time), '') IS NULL
    OR NULLIF(btrim(m.end_time), '') IS NULL
  );
