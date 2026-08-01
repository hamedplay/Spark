/*
# Fix _sync_minutes_decisions: use meeting_title_snapshot instead of title
*/

CREATE OR REPLACE FUNCTION public._sync_minutes_decisions(
  p_minute_id uuid,
  p_decisions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id       uuid;
  v_existing_status text;
  v_created_by     uuid;
  v_arr           jsonb;
  v_dec           jsonb;
  i               int;
  v_dec_id         uuid;
  v_title          text;
  v_desc           text;
  v_owner          uuid;
  v_old_owner      uuid;
  v_unit_id        uuid;
  v_unit_name      text;
  v_priority       text;
  v_start_date     date;
  v_due_date       date;
  v_followup       boolean;
  v_agenda_result_id uuid;
  v_meeting_agenda_item_id uuid;
  v_discussion     text;
  v_result_type    text;
  v_add_notes      text;
  v_existing       RECORD;
  v_existing_status_val text;
  v_existing_progress int;
  v_existing_completed timestamptz;
  v_existing_update text;
  v_existing_owner uuid;
  v_minute_title   text;
  v_revision        integer;
  v_idempotency    text;
  v_context         jsonb;
  v_owner_name     text;
  v_actor_name     text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF p_decisions IS NOT NULL AND jsonb_typeof(p_decisions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, created_by_user_id, meeting_title_snapshot, revision_number
  INTO v_existing_status, v_created_by, v_minute_title, v_revision
  FROM public.minutes
  WHERE id = p_minute_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    v_existing_status IN ('draft', 'changes_requested')
    AND (
      public.is_current_user_admin()
      OR v_created_by = v_user_id
      OR EXISTS (SELECT 1 FROM public.minutes WHERE id = p_minute_id AND secretary_user_id = v_user_id)
      OR EXISTS (SELECT 1 FROM public.minutes WHERE id = p_minute_id AND chair_user_id = v_user_id)
    )
  ) THEN
    RAISE EXCEPTION 'MINUTES_NO_PERMISSION' USING ERRCODE = 'P0001';
  END IF;

  v_arr := COALESCE(p_decisions, '[]'::jsonb);

  -- Validate each decision
  FOR i IN 0..jsonb_array_length(v_arr) - 1 LOOP
    v_dec := v_arr->i;
    v_title := v_dec->>'title';
    v_owner := NULLIF(v_dec->>'primary_owner_user_id', '')::uuid;
    v_start_date := NULLIF(v_dec->>'start_date', '')::date;
    v_due_date := NULLIF(v_dec->>'due_date', '')::date;

    IF v_title IS NULL OR btrim(v_title) = '' THEN
      RAISE EXCEPTION 'DECISION_TITLE_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'DECISION_OWNER_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    IF v_start_date IS NOT NULL AND v_due_date IS NOT NULL AND v_due_date < v_start_date THEN
      RAISE EXCEPTION 'DECISION_DUE_BEFORE_START' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- Resolve actor name for context
  SELECT COALESCE(NULLIF(full_name, ''), 'کاربر') INTO v_actor_name
  FROM public.profiles WHERE user_id = v_user_id LIMIT 1;

  -- Build a temp map of existing decisions (including owner for diff)
  CREATE TEMP TABLE IF NOT EXISTS _tmp_existing_decisions ON COMMIT DROP AS
  SELECT id, status, progress_percent, completed_at, latest_update, primary_owner_user_id
  FROM public.minutes_decisions
  WHERE minute_id = p_minute_id;

  -- Delete all existing decisions for this minute
  DELETE FROM public.minutes_decisions WHERE minute_id = p_minute_id;

  -- Re-insert from payload
  FOR i IN 0..jsonb_array_length(v_arr) - 1 LOOP
    v_dec := v_arr->i;
    v_dec_id := NULLIF(v_dec->>'id', '')::uuid;
    v_title := v_dec->>'title';
    v_desc := v_dec->>'description';
    v_owner := NULLIF(v_dec->>'primary_owner_user_id', '')::uuid;
    v_unit_id := NULLIF(v_dec->>'responsible_unit_id', '')::uuid;
    v_unit_name := v_dec->>'responsible_unit_name_snapshot';
    v_priority := COALESCE(v_dec->>'priority', 'normal');
    v_start_date := NULLIF(v_dec->>'start_date', '')::date;
    v_due_date := NULLIF(v_dec->>'due_date', '')::date;
    v_followup := COALESCE((v_dec->>'requires_followup')::boolean, true);
    v_meeting_agenda_item_id := NULLIF(v_dec->>'meeting_agenda_item_id', '')::uuid;
    v_discussion := v_dec->>'discussion_result';
    v_result_type := v_dec->>'result_type';
    v_add_notes := v_dec->>'additional_notes';

    -- Resolve agenda_result_id
    v_agenda_result_id := NULL;
    IF v_meeting_agenda_item_id IS NOT NULL THEN
      SELECT ar.id INTO v_agenda_result_id
      FROM public.minutes_agenda_results ar
      WHERE ar.minute_id = p_minute_id
      AND ar.meeting_agenda_item_id = v_meeting_agenda_item_id
      LIMIT 1;
    ELSIF NULLIF(v_dec->>'agenda_result_id', '')::uuid IS NOT NULL THEN
      SELECT ar.id INTO v_agenda_result_id
      FROM public.minutes_agenda_results ar
      WHERE ar.id = (NULLIF(v_dec->>'agenda_result_id', '')::uuid)
      AND ar.minute_id = p_minute_id
      LIMIT 1;
    END IF;

    -- Defaults for new decisions
    v_existing_status_val := 'not_started';
    v_existing_progress := 0;
    v_existing_completed := NULL;
    v_existing_update := NULL;
    v_existing_owner := NULL;

    -- If this decision has an id that existed before, preserve status fields
    IF v_dec_id IS NOT NULL THEN
      SELECT status, progress_percent, completed_at, latest_update, primary_owner_user_id
      INTO v_existing_status_val, v_existing_progress, v_existing_completed, v_existing_update, v_existing_owner
      FROM _tmp_existing_decisions
      WHERE id = v_dec_id;
    END IF;

    INSERT INTO public.minutes_decisions (
      id, minute_id, agenda_result_id,
      title, description,
      primary_owner_user_id, responsible_unit_id, responsible_unit_name_snapshot,
      priority, status, progress_percent, completed_at,
      start_date, due_date, requires_followup, latest_update,
      created_by_user_id,
      discussion_result, result_type, additional_notes
    ) VALUES (
      COALESCE(v_dec_id, gen_random_uuid()),
      p_minute_id,
      v_agenda_result_id,
      v_title, v_desc,
      v_owner, v_unit_id, v_unit_name,
      v_priority,
      COALESCE(v_existing_status_val, 'not_started'),
      COALESCE(v_existing_progress, 0),
      v_existing_completed,
      v_start_date, v_due_date, v_followup,
      v_existing_update,
      v_user_id,
      v_discussion, v_result_type, v_add_notes
    )
    RETURNING id INTO v_dec_id;

    -- ── Emit decision_assigned if owner is new or changed ────────────────
    IF v_owner IS NOT NULL AND v_owner IS DISTINCT FROM v_user_id THEN
      IF v_existing_owner IS NULL OR v_existing_owner IS DISTINCT FROM v_owner THEN
        -- Resolve owner name from profiles
        SELECT COALESCE(NULLIF(full_name, ''), 'مسئول مصوبه') INTO v_owner_name
        FROM public.profiles WHERE user_id = v_owner LIMIT 1;

        v_idempotency := 'decision:' || v_dec_id::text || ':decision_assigned:' || v_owner::text || ':' || COALESCE(v_revision::text, '0');
        v_context := jsonb_build_object(
          'decision_title', v_title,
          'decision_owner_name', v_owner_name,
          'decision_due_date', COALESCE(v_due_date::text, ''),
          'responsible_unit', COALESCE(v_unit_name, ''),
          'minute_title', COALESCE(v_minute_title, ''),
          'decision_link', '#minutes-my-decisions?decision=' || v_dec_id::text,
          'actor_name', v_actor_name,
          'audience', 'decision_owner'
        );

        PERFORM public.resolve_and_queue_notification(
          'decision_assigned',
          v_owner,
          'decision_owner',
          'decision',
          v_dec_id,
          p_minute_id,
          v_user_id,
          v_context,
          v_idempotency,
          v_revision
        );
      END IF;
    END IF;
  END LOOP;

  DROP TABLE IF EXISTS _tmp_existing_decisions;

  RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id);
END;
$$;
