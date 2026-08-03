/*
# Fix _sync_minutes_decisions + external responsible schema
#
# 1. Make primary_owner_user_id nullable (external mode has no internal owner)
# 2. Replace compatibility constraint with full internal/external constraint
# 3. Fix _sync_minutes_decisions: accept deleted_decision_ids as separate parameter
# 4. Update get_minutes_decisions_for_view to return external responsible fields
#
# No previous migration edited. No data deleted.
*/

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Make primary_owner_user_id nullable
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.minutes_decisions
  ALTER COLUMN primary_owner_user_id DROP NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Replace compatibility constraint with full internal/external constraint
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.minutes_decisions
  DROP CONSTRAINT IF EXISTS minutes_decisions_external_responsible_check;

ALTER TABLE public.minutes_decisions
  ADD CONSTRAINT minutes_decisions_external_responsible_check
  CHECK (
    (
      responsible_party_type = 'internal'
      AND primary_owner_user_id IS NOT NULL
      AND external_responsible_name_snapshot IS NULL
      AND external_responsible_participant_id IS NULL
    )
    OR
    (
      responsible_party_type = 'external'
      AND primary_owner_user_id IS NULL
      AND external_responsible_name_snapshot IS NOT NULL
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Fix _sync_minutes_decisions: separate deleted_decision_ids parameter
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._sync_minutes_decisions(
  p_minute_id uuid,
  p_decisions jsonb,
  p_deleted_decision_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id       uuid;
  v_existing_status text;
  v_created_by     uuid;
  v_minute_title   text;
  v_revision      integer;
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
  v_meeting_agenda_item_id uuid;
  v_discussion     text;
  v_result_type    text;
  v_add_notes      text;
  v_responsible_party_type text;
  v_ext_participant_id uuid;
  v_ext_name       text;
  v_ext_org        text;
  v_ext_position   text;
  v_delete_id      uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF p_decisions IS NOT NULL AND jsonb_typeof(p_decisions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;

  SELECT m.status, m.created_by_user_id, m.meeting_title_snapshot, m.revision_number
  INTO v_existing_status, v_created_by, v_minute_title, v_revision
  FROM public.minutes m
  WHERE m.id = p_minute_id
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
  IF jsonb_array_length(v_arr) > 0 THEN
    FOR i IN 0..jsonb_array_length(v_arr) - 1 LOOP
      v_dec := v_arr->i;
      v_title := v_dec->>'title';
      v_owner := NULLIF(v_dec->>'primary_owner_user_id', '')::uuid;
      v_start_date := NULLIF(v_dec->>'start_date', '')::date;
      v_due_date := NULLIF(v_dec->>'due_date', '')::date;
      v_responsible_party_type := COALESCE(v_dec->>'responsible_party_type', 'internal');

      IF v_title IS NULL OR btrim(v_title) = '' THEN
        RAISE EXCEPTION 'DECISION_TITLE_REQUIRED' USING ERRCODE = 'P0001';
      END IF;

      IF v_responsible_party_type = 'internal' THEN
        IF v_owner IS NULL THEN
          RAISE EXCEPTION 'DECISION_OWNER_REQUIRED' USING ERRCODE = 'P0001';
        END IF;
      ELSIF v_responsible_party_type = 'external' THEN
        IF NULLIF(v_dec->>'external_responsible_name_snapshot', '') IS NULL THEN
          RAISE EXCEPTION 'DECISION_OWNER_REQUIRED' USING ERRCODE = 'P0001';
        END IF;
      END IF;

      IF v_start_date IS NOT NULL AND v_due_date IS NOT NULL AND v_due_date < v_start_date THEN
        RAISE EXCEPTION 'DECISION_DUE_BEFORE_START' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  -- Process each decision: UPDATE existing or INSERT new
  IF jsonb_array_length(v_arr) > 0 THEN
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
      v_responsible_party_type := COALESCE(v_dec->>'responsible_party_type', 'internal');
      v_ext_participant_id := NULLIF(v_dec->>'external_responsible_participant_id', '')::uuid;
      v_ext_name := v_dec->>'external_responsible_name_snapshot';
      v_ext_org := v_dec->>'external_responsible_organization_snapshot';
      v_ext_position := v_dec->>'external_responsible_position_snapshot';

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

      IF v_dec_id IS NOT NULL THEN
        -- UPDATE existing — preserve status, progress, completed_at, latest_update, created_by_user_id
        UPDATE public.minutes_decisions
        SET
          agenda_result_id = v_agenda_result_id,
          title = v_title,
          description = v_desc,
          primary_owner_user_id = v_owner,
          responsible_unit_id = v_unit_id,
          responsible_unit_name_snapshot = v_unit_name,
          priority = v_priority,
          start_date = v_start_date,
          due_date = v_due_date,
          requires_followup = v_followup,
          discussion_result = v_discussion,
          result_type = v_result_type,
          additional_notes = v_add_notes,
          responsible_party_type = v_responsible_party_type,
          external_responsible_participant_id = v_ext_participant_id,
          external_responsible_name_snapshot = v_ext_name,
          external_responsible_organization_snapshot = v_ext_org,
          external_responsible_position_snapshot = v_ext_position,
          updated_at = now()
        WHERE id = v_dec_id AND minute_id = p_minute_id;
      ELSE
        -- INSERT new
        INSERT INTO public.minutes_decisions (
          id, minute_id, agenda_result_id,
          title, description,
          primary_owner_user_id, responsible_unit_id, responsible_unit_name_snapshot,
          priority, status, progress_percent, completed_at,
          start_date, due_date, requires_followup, latest_update,
          created_by_user_id,
          discussion_result, result_type, additional_notes,
          responsible_party_type,
          external_responsible_participant_id,
          external_responsible_name_snapshot,
          external_responsible_organization_snapshot,
          external_responsible_position_snapshot
        ) VALUES (
          gen_random_uuid(),
          p_minute_id,
          v_agenda_result_id,
          v_title, v_desc,
          v_owner, v_unit_id, v_unit_name,
          v_priority, 'not_started', 0, NULL,
          v_start_date, v_due_date, v_followup, NULL,
          v_user_id,
          v_discussion, v_result_type, v_add_notes,
          v_responsible_party_type,
          v_ext_participant_id,
          v_ext_name,
          v_ext_org,
          v_ext_position
        );
      END IF;
    END LOOP;
  END IF;

  -- Delete only explicitly specified IDs that belong to this minute
  FOREACH v_delete_id IN ARRAY p_deleted_decision_ids LOOP
    DELETE FROM public.minutes_decisions
    WHERE id = v_delete_id AND minute_id = p_minute_id;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Update get_minutes_decisions_for_view to return external responsible fields
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_minutes_decisions_for_view(uuid);

CREATE FUNCTION public.get_minutes_decisions_for_view(
  p_minute_id uuid
)
RETURNS TABLE(
  id uuid,
  title text,
  description text,
  priority text,
  status text,
  progress_percent integer,
  start_date date,
  due_date date,
  responsible_unit_name_snapshot text,
  primary_owner_user_id uuid,
  owner_name text,
  requires_followup boolean,
  latest_update text,
  agenda_result_id uuid,
  agenda_title text,
  responsible_party_type text,
  external_responsible_participant_id uuid,
  external_responsible_name_snapshot text,
  external_responsible_organization_snapshot text,
  external_responsible_position_snapshot text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public._user_can_view_minute(p_minute_id) THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.title,
    d.description,
    d.priority,
    d.status::text,
    d.progress_percent,
    d.start_date,
    d.due_date,
    d.responsible_unit_name_snapshot,
    d.primary_owner_user_id,
    COALESCE(
      (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles_public p WHERE p.user_id = d.primary_owner_user_id LIMIT 1),
      ''
    ) AS owner_name,
    d.requires_followup,
    d.latest_update,
    d.agenda_result_id,
    ar.agenda_title_snapshot AS agenda_title,
    d.responsible_party_type,
    d.external_responsible_participant_id,
    d.external_responsible_name_snapshot,
    d.external_responsible_organization_snapshot,
    d.external_responsible_position_snapshot
  FROM public.minutes_decisions d
  LEFT JOIN public.minutes_agenda_results ar ON ar.id = d.agenda_result_id
  WHERE d.minute_id = p_minute_id
  ORDER BY d.created_at ASC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_minutes_decisions_for_view(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_minutes_decisions_for_view(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_minutes_decisions_for_view(uuid) TO authenticated;
