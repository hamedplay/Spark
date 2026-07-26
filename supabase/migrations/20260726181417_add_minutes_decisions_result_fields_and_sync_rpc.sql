/*
# Add result fields to minutes_decisions + sync RPC

1. Modified Tables
- `minutes_decisions`
  - Added `discussion_result` (text, nullable) — optional discussion result text moved from agenda_results.
  - Added `result_type` (text, nullable) — optional result type ('discussion'|'action'|'resolution'|'deferred'|'no_result').
  - Added `additional_notes` (text, nullable) — optional additional notes moved from agenda_results.
  - No existing columns are removed, renamed, or type-changed.
  - Existing rows get NULL for the new columns (no data backfill needed).

2. New Functions
- `_sync_minutes_decisions(p_minute_id uuid, p_decisions jsonb)`
  - Replaces all decision rows for a minute with the supplied array.
  - Preserves execution status, progress_percent, completed_at, and latest_update
    for decisions that already exist (matched by id).
  - New decisions are inserted with default status 'not_started' and progress 0.
  - Validates: title not empty, primary_owner_user_id not null, due_date >= start_date.
  - Returns jsonb {success, minute_id} or {success:false, error_code, message}.

3. Security
- No RLS policy changes. Existing policies on `minutes_decisions` remain unchanged.
- The sync function checks the caller is authenticated and is admin/creator/secretary/chair
  of the minute (same permission contract as update_minutes_draft).

4. Important Notes
- This is additive: it only adds nullable columns and a new helper function.
- Old minutes_agenda_results columns (discussion_result, result_type, additional_notes)
  are NOT removed. Existing rows keep their original values and remain readable
  in the detail page (backward compatibility: old minutes show result from agenda;
  new minutes show result from decision; if both exist, decision is authoritative).
- Frontend will call _sync_minutes_decisions after create/update_minutes_draft.
*/

ALTER TABLE minutes_decisions
  ADD COLUMN IF NOT EXISTS discussion_result text,
  ADD COLUMN IF NOT EXISTS result_type text,
  ADD COLUMN IF NOT EXISTS additional_notes text;

CREATE OR REPLACE FUNCTION public._sync_minutes_decisions(
  p_minute_id uuid,
  p_decisions jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
  v_unit_id        uuid;
  v_unit_name      text;
  v_priority       text;
  v_start_date     date;
  v_due_date       date;
  v_followup       boolean;
  v_agenda_result_id uuid;
  v_discussion     text;
  v_result_type    text;
  v_add_notes      text;
  v_existing       RECORD;
  v_existing_status_val text;
  v_existing_progress int;
  v_existing_completed timestamptz;
  v_existing_update text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF p_decisions IS NOT NULL AND jsonb_typeof(p_decisions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;

  -- Permission check: same contract as update_minutes_draft
  SELECT status, created_by_user_id
  INTO v_existing_status, v_created_by
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

  -- Collect existing decision ids to preserve status/progress
  -- We delete and re-insert, but carry over status fields for matching ids.

  -- Build a temp map of existing decisions
  CREATE TEMP TABLE IF NOT EXISTS _tmp_existing_decisions ON COMMIT DROP AS
    SELECT id, status, progress_percent, completed_at, latest_update
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
    v_agenda_result_id := NULLIF(v_dec->>'agenda_result_id', '')::uuid;
    v_discussion := v_dec->>'discussion_result';
    v_result_type := v_dec->>'result_type';
    v_add_notes := v_dec->>'additional_notes';

    -- Defaults for new decisions
    v_existing_status_val := 'not_started';
    v_existing_progress := 0;
    v_existing_completed := NULL;
    v_existing_update := NULL;

    -- If this decision has an id that existed before, preserve status fields
    IF v_dec_id IS NOT NULL THEN
      SELECT status, progress_percent, completed_at, latest_update
      INTO v_existing_status_val, v_existing_progress, v_existing_completed, v_existing_update
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
    );
  END LOOP;

  DROP TABLE IF EXISTS _tmp_existing_decisions;

  RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id);
END;
$function$;
