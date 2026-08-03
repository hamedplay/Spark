/*
# Fix create_minutes_draft + update_minutes_draft + non-destructive external participant sync
#
# 1. create_minutes_draft: call _sync_minutes_decisions with 3-arg signature (uuid, jsonb, uuid[])
# 2. update_minutes_draft: new 5-param version with p_deleted_decision_ids + p_deleted_external_participant_ids
#    Old 4-param version becomes a wrapper calling the 5-param version with empty arrays.
# 3. Non-destructive external participant sync (UPDATE existing, INSERT new, DELETE only explicit ids)
# 4. _sync_minutes_decisions: REVOKE from PUBLIC/anon/authenticated (helper only, called from SECURITY DEFINER)
# 5. _sync_minutes_decisions: validate external_responsible_participant_id belongs to same minute
#
# No previous migration edited. No data deleted. No CASCADE added.
*/

-- ════════════════════════════════════════════════════════════════════════════
-- 1. REVOKE direct access to _sync_minutes_decisions helper
-- ════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb, uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb, uuid[]) FROM authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Redefine _sync_minutes_decisions with external participant validation
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
  v_ext_part_minute_id uuid;
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
        -- Ensure external fields are null for internal
        IF NULLIF(v_dec->>'external_responsible_name_snapshot', '') IS NOT NULL
           OR NULLIF(v_dec->>'external_responsible_participant_id', '')::uuid IS NOT NULL THEN
          RAISE EXCEPTION 'INTERNAL_DECISION_CANNOT_HAVE_EXTERNAL_FIELDS' USING ERRCODE = 'P0001';
        END IF;
      ELSIF v_responsible_party_type = 'external' THEN
        -- Name snapshot is required
        IF NULLIF(v_dec->>'external_responsible_name_snapshot', '') IS NULL THEN
          RAISE EXCEPTION 'DECISION_OWNER_REQUIRED' USING ERRCODE = 'P0001';
        END IF;
        -- primary_owner_user_id must be null
        IF v_owner IS NOT NULL THEN
          RAISE EXCEPTION 'EXTERNAL_DECISION_CANNOT_HAVE_INTERNAL_OWNER' USING ERRCODE = 'P0001';
        END IF;
        -- If external_responsible_participant_id is provided, verify it belongs to this minute
        v_ext_participant_id := NULLIF(v_dec->>'external_responsible_participant_id', '')::uuid;
        IF v_ext_participant_id IS NOT NULL THEN
          SELECT ep.minute_id INTO v_ext_part_minute_id
          FROM public.minutes_external_participants ep
          WHERE ep.id = v_ext_participant_id
          LIMIT 1;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'EXTERNAL_PARTICIPANT_NOT_FOUND' USING ERRCODE = 'P0001';
          END IF;
          IF v_ext_part_minute_id IS DISTINCT FROM p_minute_id THEN
            RAISE EXCEPTION 'EXTERNAL_PARTICIPANT_SCOPE_INVALID' USING ERRCODE = 'P0001';
          END IF;
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

      -- For internal, force external fields to null
      IF v_responsible_party_type = 'internal' THEN
        v_ext_participant_id := NULL;
        v_ext_name := NULL;
        v_ext_org := NULL;
        v_ext_position := NULL;
      END IF;

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

-- Re-REVOKE after CREATE OR REPLACE (permissions are reset)
REVOKE EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb, uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb, uuid[]) FROM authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Redefine create_minutes_draft: use 3-arg _sync_minutes_decisions + include external participant id
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_minutes_draft(
  p_payload jsonb,
  p_decisions jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id          uuid;
  v_arr              jsonb;
  v_internal_parts  jsonb;
  v_external_parts  jsonb;
  v_agenda_arr      jsonb;

  v_meeting_id       uuid;
  v_title            text;
  v_date             text;
  v_start_time       text;
  v_end_time         text;
  v_location         text;
  v_meeting_type     text;
  v_org_unit_id      uuid;
  v_org_unit_name    text;
  v_sec_user_id      uuid;
  v_sec_name         text;
  v_chair_user_id    uuid;
  v_chair_name       text;
  v_notes            text;
  v_confidentiality  text;
  v_approval_mode    text;

  v_minute_id        uuid;
  v_part             jsonb;
  v_agenda           jsonb;
  i                  int;

  v_p_user_id        uuid;
  v_p_name           text;
  v_p_position       text;
  v_p_org_unit_id    uuid;
  v_p_org_unit_name  text;
  v_p_inv_status     text;
  v_p_att_status     text;
  v_p_notes          text;

  v_ep_id            uuid;
  v_ep_full_name     text;
  v_ep_organization  text;
  v_ep_position      text;
  v_ep_mobile        text;
  v_ep_email         text;
  v_ep_att_status    text;
  v_ep_notes         text;

  v_a_item_id        uuid;
  v_a_sort_order     int;
  v_a_title          text;
  v_a_desc           text;
  v_a_presenter      text;
  v_a_alloc_min      int;
  v_a_discussion     text;
  v_a_result_type    text;
  v_a_add_notes      text;

  v_constraint_name  text;
  v_msg_text         text;
  v_diag_sqlstate    text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;

  v_arr := p_payload->'internal_participants';
  IF v_arr IS NOT NULL AND jsonb_typeof(v_arr) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;
  v_arr := p_payload->'external_participants';
  IF v_arr IS NOT NULL AND jsonb_typeof(v_arr) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;
  v_arr := p_payload->'agenda_results';
  IF v_arr IS NOT NULL AND jsonb_typeof(v_arr) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF p_decisions IS NOT NULL AND jsonb_typeof(p_decisions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;

  v_meeting_id      := NULLIF(p_payload->>'meeting_id', '')::uuid;
  v_title           := p_payload->>'meeting_title_snapshot';
  v_date            := p_payload->>'meeting_date_snapshot';
  v_start_time      := p_payload->>'meeting_start_time_snapshot';
  v_end_time        := p_payload->>'meeting_end_time_snapshot';
  v_location        := p_payload->>'meeting_location_snapshot';
  v_meeting_type    := p_payload->>'meeting_type';
  v_org_unit_id     := NULLIF(p_payload->>'org_unit_id', '')::uuid;
  v_org_unit_name   := p_payload->>'org_unit_name_snapshot';
  v_sec_user_id     := NULLIF(p_payload->>'secretary_user_id', '')::uuid;
  v_sec_name        := p_payload->>'secretary_name_snapshot';
  v_chair_user_id   := NULLIF(p_payload->>'chair_user_id', '')::uuid;
  v_chair_name      := p_payload->>'chair_name_snapshot';
  v_notes           := p_payload->>'notes';
  v_confidentiality := p_payload->>'confidentiality';
  v_approval_mode   := p_payload->>'approval_mode';

  v_internal_parts := p_payload->'internal_participants';
  v_external_parts := p_payload->'external_participants';
  v_agenda_arr     := p_payload->'agenda_results';

  IF v_meeting_id IS NULL THEN
    RAISE EXCEPTION 'MEETING_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_title IS NULL OR btrim(v_title) = '' THEN
    RAISE EXCEPTION 'TITLE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_date IS NULL OR btrim(v_date) = '' THEN
    RAISE EXCEPTION 'DATE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_sec_name IS NULL OR btrim(v_sec_name) = '' THEN
    RAISE EXCEPTION 'SECRETARY_NAME_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_chair_name IS NULL OR btrim(v_chair_name) = '' THEN
    RAISE EXCEPTION 'CHAIR_NAME_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_confidentiality IS NULL
  OR v_confidentiality NOT IN ('public', 'organizational', 'restricted', 'confidential') THEN
    RAISE EXCEPTION 'INVALID_CONFIDENTIALITY' USING ERRCODE = 'P0001';
  END IF;

  IF v_approval_mode IS NOT NULL
  AND v_approval_mode NOT IN ('system', 'in_person') THEN
    RAISE EXCEPTION 'INVALID_APPROVAL_MODE' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.can_create_minutes_for_meeting(v_meeting_id) THEN
    RAISE EXCEPTION 'MEETING_NO_PERMISSION' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.minutes WHERE meeting_id = v_meeting_id) THEN
    RAISE EXCEPTION 'MINUTES_ALREADY_EXISTS' USING ERRCODE = 'P0001';
  END IF;

  IF v_sec_user_id IS NOT NULL THEN
    IF NOT public._minutes_user_exists(v_sec_user_id) THEN
      RAISE EXCEPTION 'SECRETARY_USER_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF NOT public._minutes_user_belongs_to_meeting(v_meeting_id, v_sec_user_id) THEN
      RAISE EXCEPTION 'SECRETARY_NOT_MEETING_PARTICIPANT' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_chair_user_id IS NOT NULL THEN
    IF NOT public._minutes_user_exists(v_chair_user_id) THEN
      RAISE EXCEPTION 'CHAIR_USER_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF NOT public._minutes_user_belongs_to_meeting(v_meeting_id, v_chair_user_id) THEN
      RAISE EXCEPTION 'CHAIR_NOT_MEETING_PARTICIPANT' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_org_unit_id IS NOT NULL AND
  NOT EXISTS (SELECT 1 FROM public.org_units WHERE id = v_org_unit_id) THEN
    RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_internal_parts IS NOT NULL THEN
  FOR i IN 0..jsonb_array_length(v_internal_parts) - 1 LOOP
    v_part := v_internal_parts->i;
    v_p_name := v_part->>'name_snapshot';
    IF v_p_name IS NULL OR btrim(v_p_name) = '' THEN
      RAISE EXCEPTION 'PARTICIPANT_NAME_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    v_p_inv_status := v_part->>'invitation_status';
    IF v_p_inv_status IS NULL
    OR v_p_inv_status NOT IN ('invited', 'accepted', 'declined', 'no_response', 'delegated') THEN
      RAISE EXCEPTION 'INVALID_INVITATION_STATUS' USING ERRCODE = 'P0001';
    END IF;
    v_p_att_status := v_part->>'attendance_status';
    IF v_p_att_status IS NOT NULL
    AND v_p_att_status NOT IN ('present', 'absent', 'online', 'late', 'delegate_attended') THEN
      RAISE EXCEPTION 'INVALID_ATTENDANCE_STATUS' USING ERRCODE = 'P0001';
    END IF;
    v_p_user_id := NULLIF(v_part->>'user_id', '')::uuid;
    IF v_p_user_id IS NOT NULL AND
    NOT public._minutes_user_exists(v_p_user_id) THEN
      RAISE EXCEPTION 'PARTICIPANT_USER_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  END IF;

  IF v_external_parts IS NOT NULL THEN
  FOR i IN 0..jsonb_array_length(v_external_parts) - 1 LOOP
    v_part := v_external_parts->i;
    v_ep_full_name := v_part->>'full_name';
    IF v_ep_full_name IS NULL OR btrim(v_ep_full_name) = '' THEN
      RAISE EXCEPTION 'EXTERNAL_PARTICIPANT_NAME_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  END IF;

  IF v_agenda_arr IS NOT NULL THEN
  FOR i IN 0..jsonb_array_length(v_agenda_arr) - 1 LOOP
    v_agenda := v_agenda_arr->i;
    v_a_title := v_agenda->>'agenda_title_snapshot';
    IF v_a_title IS NULL OR btrim(v_a_title) = '' THEN
      RAISE EXCEPTION 'AGENDA_TITLE_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  END IF;

  v_minute_id := gen_random_uuid();

  BEGIN
  INSERT INTO public.minutes (
    id,
    meeting_id, meeting_title_snapshot, meeting_date_snapshot,
    meeting_start_time_snapshot, meeting_end_time_snapshot,
    meeting_location_snapshot, meeting_type, org_unit_id, org_unit_name_snapshot,
    secretary_user_id, secretary_name_snapshot, chair_user_id, chair_name_snapshot,
    notes, confidentiality, status, created_by_user_id, approval_mode
  ) VALUES (
    v_minute_id,
    v_meeting_id, v_title, v_date, v_start_time, v_end_time, v_location,
    v_meeting_type, v_org_unit_id, v_org_unit_name,
    v_sec_user_id, v_sec_name, v_chair_user_id, v_chair_name,
    v_notes, v_confidentiality, 'draft', v_user_id, NULLIF(v_approval_mode, '')
  );
  EXCEPTION WHEN unique_violation OR foreign_key_violation OR check_violation THEN
  GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME,
  v_msg_text = MESSAGE_TEXT,
  v_diag_sqlstate = RETURNED_SQLSTATE;
  RAISE EXCEPTION 'INSERT_FAILED: % (%)', v_msg_text, v_constraint_name USING ERRCODE = v_diag_sqlstate;
  END;

  IF v_internal_parts IS NOT NULL THEN
  FOR i IN 0..jsonb_array_length(v_internal_parts) - 1 LOOP
    v_part := v_internal_parts->i;
    v_p_user_id := NULLIF(v_part->>'user_id', '')::uuid;
    v_p_name := v_part->>'name_snapshot';
    v_p_position := v_part->>'position_snapshot';
    v_p_org_unit_id := NULLIF(v_part->>'org_unit_id', '')::uuid;
    v_p_org_unit_name := v_part->>'org_unit_name_snapshot';
    v_p_inv_status := v_part->>'invitation_status';
    v_p_att_status := v_part->>'attendance_status';
    v_p_notes := v_part->>'notes';

    INSERT INTO public.minutes_participants (
      minute_id, user_id, name_snapshot, position_snapshot,
      org_unit_id, org_unit_name_snapshot,
      invitation_status, attendance_status, notes
    ) VALUES (
      v_minute_id, v_p_user_id, v_p_name, v_p_position,
      v_p_org_unit_id, v_p_org_unit_name,
      v_p_inv_status, v_p_att_status, v_p_notes
    );
  END LOOP;
  END IF;

  IF v_external_parts IS NOT NULL THEN
  FOR i IN 0..jsonb_array_length(v_external_parts) - 1 LOOP
    v_part := v_external_parts->i;
    v_ep_id := NULLIF(v_part->>'id', '')::uuid;
    v_ep_full_name := v_part->>'full_name';
    v_ep_organization := v_part->>'organization';
    v_ep_position := v_part->>'position';
    v_ep_mobile := v_part->>'mobile';
    v_ep_email := v_part->>'email';
    v_ep_att_status := v_part->>'attendance_status';
    v_ep_notes := v_part->>'notes';

    INSERT INTO public.minutes_external_participants (
      id, minute_id, full_name, organization, position, mobile, email,
      attendance_status, notes
    ) VALUES (
      COALESCE(v_ep_id, gen_random_uuid()),
      v_minute_id, v_ep_full_name, v_ep_organization, v_ep_position,
      v_ep_mobile, v_ep_email, v_ep_att_status, v_ep_notes
    );
  END LOOP;
  END IF;

  IF v_agenda_arr IS NOT NULL THEN
  FOR i IN 0..jsonb_array_length(v_agenda_arr) - 1 LOOP
    v_agenda := v_agenda_arr->i;
    v_a_item_id := NULLIF(v_agenda->>'meeting_agenda_item_id', '')::uuid;
    v_a_sort_order := (v_agenda->>'sort_order_snapshot')::int;
    v_a_title := v_agenda->>'agenda_title_snapshot';
    v_a_desc := v_agenda->>'agenda_description_snapshot';
    v_a_presenter := v_agenda->>'presenter_snapshot';
    v_a_alloc_min := NULLIF(v_agenda->>'allocated_minutes_snapshot', '')::int;
    v_a_discussion := v_agenda->>'discussion_result';
    v_a_result_type := v_agenda->>'result_type';
    v_a_add_notes := v_agenda->>'additional_notes';

    INSERT INTO public.minutes_agenda_results (
      minute_id, meeting_agenda_item_id, sort_order_snapshot,
      agenda_title_snapshot, agenda_description_snapshot,
      presenter_snapshot, allocated_minutes_snapshot,
      discussion_result, result_type, additional_notes
    ) VALUES (
      v_minute_id, v_a_item_id, v_a_sort_order,
      v_a_title, v_a_desc,
      v_a_presenter, v_a_alloc_min,
      v_a_discussion, v_a_result_type, v_a_add_notes
    );
  END LOOP;
  END IF;

  -- Sync decisions: use 3-arg signature with empty deleted array
  IF p_decisions IS NOT NULL THEN
    PERFORM public._sync_minutes_decisions(v_minute_id, p_decisions, '{}'::uuid[]);
  END IF;

  RETURN jsonb_build_object('success', true, 'minute_id', v_minute_id);
EXCEPTION WHEN OTHERS THEN
  v_msg_text := SQLERRM;
  v_diag_sqlstate := SQLSTATE;
  RETURN jsonb_build_object('success', false, 'error_code', v_msg_text, 'message', v_msg_text);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_minutes_draft(jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_minutes_draft(jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_minutes_draft(jsonb, jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Redefine update_minutes_draft: 5-param version + non-destructive external sync
-- ════════════════════════════════════════════════════════════════════════════

-- Drop old 4-param version; we'll recreate it as a wrapper
DROP FUNCTION IF EXISTS public.update_minutes_draft(uuid, timestamptz, jsonb, jsonb);

-- New 5-param version (no default on 5th param to avoid ambiguity)
CREATE FUNCTION public.update_minutes_draft(
  p_minute_id uuid,
  p_expected_updated_at timestamptz,
  p_payload jsonb,
  p_decisions jsonb,
  p_deleted_decision_ids uuid[],
  p_deleted_external_participant_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id          uuid;
  v_existing_status  text;
  v_existing_updated_at timestamptz;
  v_meeting_id       uuid;
  v_created_by       uuid;

  v_arr              jsonb;
  v_internal_parts  jsonb;
  v_external_parts  jsonb;
  v_agenda_arr      jsonb;

  v_title            text;
  v_date             text;
  v_start_time       text;
  v_end_time         text;
  v_location         text;
  v_meeting_type     text;
  v_org_unit_id      uuid;
  v_org_unit_name    text;
  v_sec_user_id      uuid;
  v_sec_name         text;
  v_chair_user_id    uuid;
  v_chair_name       text;
  v_notes            text;
  v_confidentiality  text;
  v_approval_mode    text;

  v_new_updated_at   timestamptz;
  v_part             jsonb;
  v_agenda           jsonb;
  i                  int;

  v_p_user_id        uuid;
  v_p_name           text;
  v_p_position       text;
  v_p_org_unit_id    uuid;
  v_p_org_unit_name  text;
  v_p_inv_status     text;
  v_p_att_status     text;
  v_p_notes          text;

  v_ep_id            uuid;
  v_ep_full_name     text;
  v_ep_organization  text;
  v_ep_position      text;
  v_ep_mobile        text;
  v_ep_email         text;
  v_ep_att_status    text;
  v_ep_notes         text;
  v_ep_exists        boolean;
  v_ep_scope_minute  uuid;
  v_del_ep_id        uuid;

  v_a_item_id        uuid;
  v_a_sort_order     int;
  v_a_title          text;
  v_a_desc           text;
  v_a_presenter      text;
  v_a_alloc_min      int;
  v_a_discussion     text;
  v_a_result_type    text;
  v_a_add_notes      text;

  v_constraint_name  text;
  v_msg_text         text;
  v_diag_sqlstate    text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;
  v_arr := p_payload->'internal_participants';
  IF v_arr IS NOT NULL AND jsonb_typeof(v_arr) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;
  v_arr := p_payload->'external_participants';
  IF v_arr IS NOT NULL AND jsonb_typeof(v_arr) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;
  v_arr := p_payload->'agenda_results';
  IF v_arr IS NOT NULL AND jsonb_typeof(v_arr) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF p_decisions IS NOT NULL AND jsonb_typeof(p_decisions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, updated_at, meeting_id, created_by_user_id
  INTO v_existing_status, v_existing_updated_at, v_meeting_id, v_created_by
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

  IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM v_existing_updated_at THEN
    RAISE EXCEPTION 'MINUTES_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  v_title           := p_payload->>'meeting_title_snapshot';
  v_date            := p_payload->>'meeting_date_snapshot';
  v_start_time      := p_payload->>'meeting_start_time_snapshot';
  v_end_time        := p_payload->>'meeting_end_time_snapshot';
  v_location        := p_payload->>'meeting_location_snapshot';
  v_meeting_type    := p_payload->>'meeting_type';
  v_org_unit_id     := NULLIF(p_payload->>'org_unit_id', '')::uuid;
  v_org_unit_name   := p_payload->>'org_unit_name_snapshot';
  v_sec_user_id     := NULLIF(p_payload->>'secretary_user_id', '')::uuid;
  v_sec_name        := p_payload->>'secretary_name_snapshot';
  v_chair_user_id   := NULLIF(p_payload->>'chair_user_id', '')::uuid;
  v_chair_name      := p_payload->>'chair_name_snapshot';
  v_notes           := p_payload->>'notes';
  v_confidentiality := p_payload->>'confidentiality';
  v_approval_mode   := p_payload->>'approval_mode';

  v_internal_parts := p_payload->'internal_participants';
  v_external_parts := p_payload->'external_participants';
  v_agenda_arr     := p_payload->'agenda_results';

  IF v_title IS NULL OR btrim(v_title) = '' THEN
    RAISE EXCEPTION 'TITLE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_date IS NULL OR btrim(v_date) = '' THEN
    RAISE EXCEPTION 'DATE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_sec_name IS NULL OR btrim(v_sec_name) = '' THEN
    RAISE EXCEPTION 'SECRETARY_NAME_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_chair_name IS NULL OR btrim(v_chair_name) = '' THEN
    RAISE EXCEPTION 'CHAIR_NAME_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_confidentiality IS NULL
  OR v_confidentiality NOT IN ('public', 'organizational', 'restricted', 'confidential') THEN
    RAISE EXCEPTION 'INVALID_CONFIDENTIALITY' USING ERRCODE = 'P0001';
  END IF;

  IF v_approval_mode IS NOT NULL
  AND v_approval_mode NOT IN ('system', 'in_person') THEN
    RAISE EXCEPTION 'INVALID_APPROVAL_MODE' USING ERRCODE = 'P0001';
  END IF;

  IF v_sec_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_sec_user_id) THEN
      RAISE EXCEPTION 'SECRETARY_USER_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF NOT public._minutes_user_belongs_to_meeting(v_meeting_id, v_sec_user_id) THEN
      RAISE EXCEPTION 'SECRETARY_NOT_MEETING_PARTICIPANT' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF v_chair_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_chair_user_id) THEN
      RAISE EXCEPTION 'CHAIR_USER_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF NOT public._minutes_user_belongs_to_meeting(v_meeting_id, v_chair_user_id) THEN
      RAISE EXCEPTION 'CHAIR_NOT_MEETING_PARTICIPANT' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF v_org_unit_id IS NOT NULL AND
  NOT EXISTS (SELECT 1 FROM public.org_units WHERE id = v_org_unit_id) THEN
    RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_internal_parts IS NOT NULL THEN
  FOR i IN 0..jsonb_array_length(v_internal_parts) - 1 LOOP
    v_part := v_internal_parts->i;
    v_p_name := v_part->>'name_snapshot';
    IF v_p_name IS NULL OR btrim(v_p_name) = '' THEN
      RAISE EXCEPTION 'PARTICIPANT_NAME_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    v_p_inv_status := v_part->>'invitation_status';
    IF v_p_inv_status IS NULL
    OR v_p_inv_status NOT IN ('invited', 'accepted', 'declined', 'no_response', 'delegated') THEN
      RAISE EXCEPTION 'INVALID_INVITATION_STATUS' USING ERRCODE = 'P0001';
    END IF;
    v_p_att_status := v_part->>'attendance_status';
    IF v_p_att_status IS NOT NULL
    AND v_p_att_status NOT IN ('present', 'absent', 'online', 'late', 'delegate_attended') THEN
      RAISE EXCEPTION 'INVALID_ATTENDANCE_STATUS' USING ERRCODE = 'P0001';
    END IF;
    v_p_user_id := NULLIF(v_part->>'user_id', '')::uuid;
    IF v_p_user_id IS NOT NULL AND
    NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_p_user_id) THEN
      RAISE EXCEPTION 'PARTICIPANT_USER_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  END IF;

  IF v_external_parts IS NOT NULL THEN
  FOR i IN 0..jsonb_array_length(v_external_parts) - 1 LOOP
    v_part := v_external_parts->i;
    v_ep_full_name := v_part->>'full_name';
    IF v_ep_full_name IS NULL OR btrim(v_ep_full_name) = '' THEN
      RAISE EXCEPTION 'EXTERNAL_PARTICIPANT_NAME_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  END IF;

  IF v_agenda_arr IS NOT NULL THEN
  FOR i IN 0..jsonb_array_length(v_agenda_arr) - 1 LOOP
    v_agenda := v_agenda_arr->i;
    v_a_title := v_agenda->>'agenda_title_snapshot';
    IF v_a_title IS NULL OR btrim(v_a_title) = '' THEN
      RAISE EXCEPTION 'AGENDA_TITLE_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  END IF;

  -- Build UPDATE: include approval_mode only when status is 'draft'.
  IF v_existing_status = 'draft' THEN
  UPDATE public.minutes SET
    meeting_title_snapshot      = v_title,
    meeting_date_snapshot       = v_date,
    meeting_start_time_snapshot = v_start_time,
    meeting_end_time_snapshot   = v_end_time,
    meeting_location_snapshot   = v_location,
    meeting_type                = v_meeting_type,
    org_unit_id                 = v_org_unit_id,
    org_unit_name_snapshot      = v_org_unit_name,
    secretary_user_id           = v_sec_user_id,
    secretary_name_snapshot     = v_sec_name,
    chair_user_id               = v_chair_user_id,
    chair_name_snapshot         = v_chair_name,
    notes                       = v_notes,
    confidentiality             = v_confidentiality,
    approval_mode               = NULLIF(v_approval_mode, '')
  WHERE id = p_minute_id
  RETURNING updated_at INTO v_new_updated_at;
  ELSE
  UPDATE public.minutes SET
    meeting_title_snapshot      = v_title,
    meeting_date_snapshot       = v_date,
    meeting_start_time_snapshot = v_start_time,
    meeting_end_time_snapshot   = v_end_time,
    meeting_location_snapshot   = v_location,
    meeting_type                = v_meeting_type,
    org_unit_id                 = v_org_unit_id,
    org_unit_name_snapshot      = v_org_unit_name,
    secretary_user_id           = v_sec_user_id,
    secretary_name_snapshot     = v_sec_name,
    chair_user_id               = v_chair_user_id,
    chair_name_snapshot         = v_chair_name,
    notes                       = v_notes,
    confidentiality             = v_confidentiality
  WHERE id = p_minute_id
  RETURNING updated_at INTO v_new_updated_at;
  END IF;

  -- Internal participants: delete and re-insert (unchanged behavior)
  DELETE FROM public.minutes_participants WHERE minute_id = p_minute_id;
  -- Agenda results: delete and re-insert (unchanged behavior)
  DELETE FROM public.minutes_agenda_results WHERE minute_id = p_minute_id;

  -- Internal participants insert
  IF v_internal_parts IS NOT NULL THEN
  FOR i IN 0..jsonb_array_length(v_internal_parts) - 1 LOOP
    v_part := v_internal_parts->i;
    v_p_user_id := NULLIF(v_part->>'user_id', '')::uuid;
    v_p_name := v_part->>'name_snapshot';
    v_p_position := v_part->>'position_snapshot';
    v_p_org_unit_id := NULLIF(v_part->>'org_unit_id', '')::uuid;
    v_p_org_unit_name := v_part->>'org_unit_name_snapshot';
    v_p_inv_status := v_part->>'invitation_status';
    v_p_att_status := v_part->>'attendance_status';
    v_p_notes := v_part->>'notes';

    INSERT INTO public.minutes_participants (
      minute_id, user_id, name_snapshot, position_snapshot,
      org_unit_id, org_unit_name_snapshot,
      invitation_status, attendance_status, notes
    ) VALUES (
      p_minute_id, v_p_user_id, v_p_name, v_p_position,
      v_p_org_unit_id, v_p_org_unit_name,
      v_p_inv_status, v_p_att_status, v_p_notes
    );
  END LOOP;
  END IF;

  -- External participants: NON-DESTRUCTIVE sync (UPDATE existing, INSERT new, DELETE only explicit)
  IF v_external_parts IS NOT NULL THEN
  FOR i IN 0..jsonb_array_length(v_external_parts) - 1 LOOP
    v_part := v_external_parts->i;
    v_ep_id := NULLIF(v_part->>'id', '')::uuid;
    v_ep_full_name := v_part->>'full_name';
    v_ep_organization := v_part->>'organization';
    v_ep_position := v_part->>'position';
    v_ep_mobile := v_part->>'mobile';
    v_ep_email := v_part->>'email';
    v_ep_att_status := v_part->>'attendance_status';
    v_ep_notes := v_part->>'notes';

    IF v_ep_id IS NOT NULL THEN
      -- Check if this id belongs to this minute
      SELECT ep.minute_id INTO v_ep_scope_minute
      FROM public.minutes_external_participants ep
      WHERE ep.id = v_ep_id
      LIMIT 1;

      IF FOUND AND v_ep_scope_minute = p_minute_id THEN
        -- UPDATE existing record
        UPDATE public.minutes_external_participants
        SET
          full_name = v_ep_full_name,
          organization = v_ep_organization,
          position = v_ep_position,
          mobile = v_ep_mobile,
          email = v_ep_email,
          attendance_status = v_ep_att_status,
          notes = v_ep_notes,
          updated_at = now()
        WHERE id = v_ep_id AND minute_id = p_minute_id;
      ELSIF FOUND AND v_ep_scope_minute IS DISTINCT FROM p_minute_id THEN
        -- Belongs to a different minute
        RAISE EXCEPTION 'EXTERNAL_PARTICIPANT_SCOPE_INVALID' USING ERRCODE = 'P0001';
      ELSE
        -- Not found — insert with the provided id
        INSERT INTO public.minutes_external_participants (
          id, minute_id, full_name, organization, position, mobile, email,
          attendance_status, notes
        ) VALUES (
          v_ep_id, p_minute_id, v_ep_full_name, v_ep_organization, v_ep_position,
          v_ep_mobile, v_ep_email, v_ep_att_status, v_ep_notes
        );
      END IF;
    ELSE
      -- No id — insert new with generated id
      INSERT INTO public.minutes_external_participants (
        minute_id, full_name, organization, position, mobile, email,
        attendance_status, notes
      ) VALUES (
        p_minute_id, v_ep_full_name, v_ep_organization, v_ep_position,
        v_ep_mobile, v_ep_email, v_ep_att_status, v_ep_notes
      );
    END IF;
  END LOOP;
  END IF;

  -- Delete only explicitly specified external participant ids
  FOREACH v_del_ep_id IN ARRAY COALESCE(p_deleted_external_participant_ids, '{}'::uuid[]) LOOP
    DELETE FROM public.minutes_external_participants
    WHERE id = v_del_ep_id AND minute_id = p_minute_id;
  END LOOP;

  -- Agenda results insert
  IF v_agenda_arr IS NOT NULL THEN
  FOR i IN 0..jsonb_array_length(v_agenda_arr) - 1 LOOP
    v_agenda := v_agenda_arr->i;
    v_a_item_id := NULLIF(v_agenda->>'meeting_agenda_item_id', '')::uuid;
    v_a_sort_order := (v_agenda->>'sort_order_snapshot')::int;
    v_a_title := v_agenda->>'agenda_title_snapshot';
    v_a_desc := v_agenda->>'agenda_description_snapshot';
    v_a_presenter := v_agenda->>'presenter_snapshot';
    v_a_alloc_min := NULLIF(v_agenda->>'allocated_minutes_snapshot', '')::int;
    v_a_discussion := v_agenda->>'discussion_result';
    v_a_result_type := v_agenda->>'result_type';
    v_a_add_notes := v_agenda->>'additional_notes';

    INSERT INTO public.minutes_agenda_results (
      minute_id, meeting_agenda_item_id, sort_order_snapshot,
      agenda_title_snapshot, agenda_description_snapshot,
      presenter_snapshot, allocated_minutes_snapshot,
      discussion_result, result_type, additional_notes
    ) VALUES (
      p_minute_id, v_a_item_id, v_a_sort_order,
      v_a_title, v_a_desc,
      v_a_presenter, v_a_alloc_min,
      v_a_discussion, v_a_result_type, v_a_add_notes
    );
  END LOOP;
  END IF;

  -- Sync external participants BEFORE decisions (decisions may reference them)
  -- External participants are already synced above.

  -- Sync decisions: use 3-arg signature with explicit deleted ids
  IF p_decisions IS NOT NULL THEN
    PERFORM public._sync_minutes_decisions(
      p_minute_id,
      p_decisions,
      COALESCE(p_deleted_decision_ids, '{}'::uuid[])
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id, 'updated_at', v_new_updated_at);
EXCEPTION WHEN OTHERS THEN
  v_msg_text := SQLERRM;
  v_diag_sqlstate := SQLSTATE;
  RETURN jsonb_build_object('success', false, 'error_code', v_msg_text, 'message', v_msg_text);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb, jsonb, uuid[], uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb, jsonb, uuid[], uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb, jsonb, uuid[], uuid[]) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Backward-compat wrapper: 4-param update_minutes_draft
--    No default on 5th param in the 5-param version, so no ambiguity.
-- ════════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.update_minutes_draft(
  p_minute_id uuid,
  p_expected_updated_at timestamptz,
  p_payload jsonb,
  p_decisions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN public.update_minutes_draft(
    p_minute_id,
    p_expected_updated_at,
    p_payload,
    p_decisions,
    '{}'::uuid[],
    '{}'::uuid[]
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb, jsonb) TO authenticated;
