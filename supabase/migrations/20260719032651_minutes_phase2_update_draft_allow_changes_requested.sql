-- ============================================================
-- Migration: Minutes Phase 2 — Update update_minutes_draft
--   to allow editing in 'changes_requested' status and to
--   preserve approval_mode / revision_number / submit metadata.
--
-- Replaces the existing update_minutes_draft function (same signature).
-- No schema or policy changes here.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_minutes_draft(
  p_minute_id          uuid,
  p_expected_updated_at timestamptz,
  p_payload            jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id          uuid;
  v_existing_status  text;
  v_existing_updated_at timestamptz;
  v_meeting_id       uuid;
  v_created_by       uuid;

  v_arr              jsonb;
  v_internal_parts   jsonb;
  v_external_parts   jsonb;
  v_agenda_arr       jsonb;

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

  v_ep_full_name     text;
  v_ep_organization text;
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

  -- Lock and load existing minute
  SELECT status, updated_at, meeting_id, created_by_user_id
    INTO v_existing_status, v_existing_updated_at, v_meeting_id, v_created_by
    FROM public.minutes
   WHERE id = p_minute_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Authorization: mirror RLS UPDATE policy (draft OR changes_requested)
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

  -- Optimistic concurrency
  IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM v_existing_updated_at THEN
    RAISE EXCEPTION 'MINUTES_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  -- Extract fields (meeting_id/created_by immutable — not accepted from payload)
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

  v_internal_parts := p_payload->'internal_participants';
  v_external_parts := p_payload->'external_participants';
  v_agenda_arr     := p_payload->'agenda_results';

  -- Validation (mirrors create_minutes_draft)
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

  IF v_sec_user_id IS NOT NULL AND
     NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_sec_user_id) THEN
    RAISE EXCEPTION 'SECRETARY_USER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_chair_user_id IS NOT NULL AND
     NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_chair_user_id) THEN
    RAISE EXCEPTION 'CHAIR_USER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org_unit_id IS NOT NULL AND
     NOT EXISTS (SELECT 1 FROM public.org_units WHERE id = v_org_unit_id) THEN
    RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Validate internal participants
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
      v_p_org_unit_id := NULLIF(v_part->>'org_unit_id', '')::uuid;
      IF v_p_org_unit_id IS NOT NULL AND
         NOT EXISTS (SELECT 1 FROM public.org_units WHERE id = v_p_org_unit_id) THEN
        RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  -- Validate external participants
  IF v_external_parts IS NOT NULL THEN
    FOR i IN 0..jsonb_array_length(v_external_parts) - 1 LOOP
      v_part := v_external_parts->i;
      v_ep_full_name := v_part->>'full_name';
      IF v_ep_full_name IS NULL OR btrim(v_ep_full_name) = '' THEN
        RAISE EXCEPTION 'EXTERNAL_NAME_REQUIRED' USING ERRCODE = 'P0001';
      END IF;
      v_ep_att_status := v_part->>'attendance_status';
      IF v_ep_att_status IS NOT NULL
         AND v_ep_att_status NOT IN ('present', 'absent', 'online', 'late', 'delegate_attended') THEN
        RAISE EXCEPTION 'INVALID_ATTENDANCE_STATUS' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  -- Validate agenda results
  IF v_agenda_arr IS NOT NULL THEN
    FOR i IN 0..jsonb_array_length(v_agenda_arr) - 1 LOOP
      v_agenda := v_agenda_arr->i;
      v_a_title := v_agenda->>'agenda_title_snapshot';
      IF v_a_title IS NULL OR btrim(v_a_title) = '' THEN
        RAISE EXCEPTION 'AGENDA_TITLE_REQUIRED' USING ERRCODE = 'P0001';
      END IF;
      v_a_sort_order := COALESCE((v_agenda->>'sort_order_snapshot')::int, 0);
      IF v_a_sort_order < 0 THEN
        RAISE EXCEPTION 'AGENDA_SORT_ORDER_INVALID' USING ERRCODE = 'P0001';
      END IF;
      v_a_alloc_min := (v_agenda->>'allocated_minutes_snapshot')::int;
      IF v_a_alloc_min IS NOT NULL AND v_a_alloc_min < 0 THEN
        RAISE EXCEPTION 'AGENDA_ALLOCATED_TIME_INVALID' USING ERRCODE = 'P0001';
      END IF;
      v_a_result_type := v_agenda->>'result_type';
      IF v_a_result_type IS NULL
         OR v_a_result_type NOT IN ('discussion', 'action', 'resolution', 'deferred', 'no_result') THEN
        RAISE EXCEPTION 'INVALID_RESULT_TYPE' USING ERRCODE = 'P0001';
      END IF;
      v_a_item_id := NULLIF(v_agenda->>'meeting_agenda_item_id', '')::uuid;
      IF v_a_item_id IS NOT NULL AND
         NOT public.minutes_agenda_item_belongs_to_meeting(v_a_item_id, v_meeting_id) THEN
        RAISE EXCEPTION 'AGENDA_ITEM_MISMATCH' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  -- ── Apply changes atomically ──
  -- Parent update: do NOT touch approval_mode, revision_number, submitted_*,
  -- secretary_confirmed_*, chair_confirmed_*, published_*.
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

  -- Replace child rows (safe inside transaction). Existing approvals/comments
  -- on the minutes_approvals / minutes_approval_comments tables are NOT
  -- touched — they are keyed by revision_number and persist independently.
  DELETE FROM public.minutes_participants WHERE minute_id = p_minute_id;
  DELETE FROM public.minutes_external_participants WHERE minute_id = p_minute_id;
  DELETE FROM public.minutes_agenda_results WHERE minute_id = p_minute_id;

  -- Re-insert internal participants
  IF v_internal_parts IS NOT NULL THEN
    FOR i IN 0..jsonb_array_length(v_internal_parts) - 1 LOOP
      v_part := v_internal_parts->i;
      INSERT INTO public.minutes_participants (
        minute_id, user_id, name_snapshot, position_snapshot,
        org_unit_id, org_unit_name_snapshot, invitation_status,
        attendance_status, notes
      ) VALUES (
        p_minute_id,
        NULLIF(v_part->>'user_id', '')::uuid,
        v_part->>'name_snapshot',
        v_part->>'position_snapshot',
        NULLIF(v_part->>'org_unit_id', '')::uuid,
        v_part->>'org_unit_name_snapshot',
        v_part->>'invitation_status',
        v_part->>'attendance_status',
        v_part->>'notes'
      );
    END LOOP;
  END IF;

  -- Re-insert external participants (invitation_status always 'invited')
  IF v_external_parts IS NOT NULL THEN
    FOR i IN 0..jsonb_array_length(v_external_parts) - 1 LOOP
      v_part := v_external_parts->i;
      INSERT INTO public.minutes_external_participants (
        minute_id, full_name, organization, position, mobile, email,
        invitation_status, attendance_status, notes
      ) VALUES (
        p_minute_id,
        v_part->>'full_name',
        v_part->>'organization',
        v_part->>'position',
        v_part->>'mobile',
        v_part->>'email',
        'invited',
        v_part->>'attendance_status',
        v_part->>'notes'
      );
    END LOOP;
  END IF;

  -- Re-insert agenda results
  IF v_agenda_arr IS NOT NULL THEN
    FOR i IN 0..jsonb_array_length(v_agenda_arr) - 1 LOOP
      v_agenda := v_agenda_arr->i;
      INSERT INTO public.minutes_agenda_results (
        minute_id, meeting_agenda_item_id, sort_order_snapshot,
        agenda_title_snapshot, agenda_description_snapshot,
        presenter_snapshot, allocated_minutes_snapshot,
        discussion_result, result_type, additional_notes
      ) VALUES (
        p_minute_id,
        NULLIF(v_agenda->>'meeting_agenda_item_id', '')::uuid,
        COALESCE((v_agenda->>'sort_order_snapshot')::int, 0),
        v_agenda->>'agenda_title_snapshot',
        v_agenda->>'agenda_description_snapshot',
        v_agenda->>'presenter_snapshot',
        (v_agenda->>'allocated_minutes_snapshot')::int,
        v_agenda->>'discussion_result',
        v_agenda->>'result_type',
        v_agenda->>'additional_notes'
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'minute_id', p_minute_id,
    'updated_at', to_char(v_new_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'message', 'Draft updated successfully'
  );

  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
      IF v_constraint_name = 'minutes_participants_minute_user_unique' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'DUPLICATE_INTERNAL_PARTICIPANT',
          'sqlstate', '23505', 'message', 'این شرکت‌کننده قبلاً اضافه شده است');
      ELSIF v_constraint_name = 'minutes_agenda_results_minute_agenda_unique' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'DUPLICATE_AGENDA_ITEM',
          'sqlstate', '23505', 'message', 'این دستور جلسه قبلاً اضافه شده است');
      ELSE
        RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
          'sqlstate', '23505', 'message', 'خطای داخلی در به‌روزرسانی پیش‌نویس');
      END IF;
    WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_msg_text = MESSAGE_TEXT;
      RETURN jsonb_build_object('success', false, 'error_code', v_msg_text,
        'sqlstate', 'P0001', 'message', v_msg_text);
    WHEN invalid_text_representation OR numeric_value_out_of_range OR datatype_mismatch THEN
      GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
      RETURN jsonb_build_object('success', false, 'error_code', 'PAYLOAD_INVALID',
        'sqlstate', v_diag_sqlstate, 'message', 'ساختار اطلاعات ارسالی معتبر نیست');
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
      RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
        'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در به‌روزرسانی پیش‌نویس');
END;
$$;

REVOKE ALL ON FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb) TO authenticated;
