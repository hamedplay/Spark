-- ============================================================
-- Migration: Create atomic Draft Minutes RPC and Agenda Item Helper
--
-- Creates two new functions:
--   1. public.minutes_agenda_item_belongs_to_meeting(uuid, uuid) — SECURITY DEFINER helper
--   2. public.create_minutes_draft(jsonb) — SECURITY INVOKER RPC
--
-- No existing tables, policies, triggers, or functions are modified.
-- No test data is inserted.
-- ============================================================

-- ============================================================
-- Helper: minutes_agenda_item_belongs_to_meeting
-- ============================================================

CREATE OR REPLACE FUNCTION public.minutes_agenda_item_belongs_to_meeting(
  p_agenda_item_id uuid,
  p_meeting_id     uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.meeting_agenda_items
    WHERE id = p_agenda_item_id
      AND meeting_id = p_meeting_id
  );
$$;

REVOKE ALL ON FUNCTION public.minutes_agenda_item_belongs_to_meeting(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.minutes_agenda_item_belongs_to_meeting(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.minutes_agenda_item_belongs_to_meeting(uuid, uuid) TO authenticated;


-- ============================================================
-- RPC: create_minutes_draft
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_minutes_draft(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  -- Auth
  v_user_id          uuid;

  -- Payload type check
  v_arr              jsonb;

  -- Arrays
  v_internal_parts   jsonb;
  v_external_parts   jsonb;
  v_agenda_arr       jsonb;

  -- Minutes fields
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

  -- Inserted minute ID
  v_minute_id        uuid;

  -- Loop
  v_part             jsonb;
  v_agenda           jsonb;
  i                  int;

  -- Internal participant fields
  v_p_user_id        uuid;
  v_p_name           text;
  v_p_position       text;
  v_p_org_unit_id    uuid;
  v_p_org_unit_name  text;
  v_p_inv_status     text;
  v_p_att_status     text;
  v_p_notes          text;

  -- External participant fields
  v_ep_full_name     text;
  v_ep_organization  text;
  v_ep_position      text;
  v_ep_mobile        text;
  v_ep_email         text;
  v_ep_att_status    text;
  v_ep_notes         text;

  -- Agenda result fields
  v_a_item_id        uuid;
  v_a_sort_order     int;
  v_a_title          text;
  v_a_desc           text;
  v_a_presenter      text;
  v_a_alloc_min      int;
  v_a_discussion     text;
  v_a_result_type    text;
  v_a_add_notes      text;

  -- Diagnostics
  v_constraint_name  text;
  v_msg_text         text;
  v_diag_sqlstate    text;
BEGIN
  -- Step 1: Authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Step 2: Payload type validation (before any cast or loop)
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

  -- Step 3: Extract and cast minutes fields
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

  -- Store arrays
  v_internal_parts := p_payload->'internal_participants';
  v_external_parts := p_payload->'external_participants';
  v_agenda_arr     := p_payload->'agenda_results';

  -- Step 4: Validate required minutes fields
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

  -- Step 5: Meeting permission (only via existing function)
  IF NOT public.can_create_minutes_for_meeting(v_meeting_id) THEN
    RAISE EXCEPTION 'MEETING_NO_PERMISSION' USING ERRCODE = 'P0001';
  END IF;

  -- Step 6: Duplicate meeting_id (explicit check; race covered by unique_violation handler)
  IF EXISTS (SELECT 1 FROM public.minutes WHERE meeting_id = v_meeting_id) THEN
    RAISE EXCEPTION 'MINUTES_ALREADY_EXISTS' USING ERRCODE = 'P0001';
  END IF;

  -- Step 7: Validate secretary and chair against profiles.user_id
  IF v_sec_user_id IS NOT NULL AND
     NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_sec_user_id) THEN
    RAISE EXCEPTION 'SECRETARY_USER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_chair_user_id IS NOT NULL AND
     NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_chair_user_id) THEN
    RAISE EXCEPTION 'CHAIR_USER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Step 8: Validate org_unit_id
  IF v_org_unit_id IS NOT NULL AND
     NOT EXISTS (SELECT 1 FROM public.org_units WHERE id = v_org_unit_id) THEN
    RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Step 9: Validate internal_participants array
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

  -- Step 10: Validate external_participants array
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

  -- Step 11: Validate agenda_results array
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

  -- Step 12: INSERT into public.minutes
  INSERT INTO public.minutes (
    meeting_id,
    meeting_title_snapshot,
    meeting_date_snapshot,
    meeting_start_time_snapshot,
    meeting_end_time_snapshot,
    meeting_location_snapshot,
    meeting_type,
    org_unit_id,
    org_unit_name_snapshot,
    secretary_user_id,
    secretary_name_snapshot,
    chair_user_id,
    chair_name_snapshot,
    notes,
    confidentiality,
    status,
    created_by_user_id
  ) VALUES (
    v_meeting_id,
    v_title,
    v_date,
    v_start_time,
    v_end_time,
    v_location,
    v_meeting_type,
    v_org_unit_id,
    v_org_unit_name,
    v_sec_user_id,
    v_sec_name,
    v_chair_user_id,
    v_chair_name,
    v_notes,
    v_confidentiality,
    'draft',
    v_user_id
  )
  RETURNING id INTO v_minute_id;

  -- Step 13: INSERT internal participants
  IF v_internal_parts IS NOT NULL THEN
    FOR i IN 0..jsonb_array_length(v_internal_parts) - 1 LOOP
      v_part := v_internal_parts->i;

      v_p_user_id       := NULLIF(v_part->>'user_id', '')::uuid;
      v_p_name          := v_part->>'name_snapshot';
      v_p_position      := v_part->>'position_snapshot';
      v_p_org_unit_id   := NULLIF(v_part->>'org_unit_id', '')::uuid;
      v_p_org_unit_name := v_part->>'org_unit_name_snapshot';
      v_p_inv_status    := v_part->>'invitation_status';
      v_p_att_status    := v_part->>'attendance_status';
      v_p_notes         := v_part->>'notes';

      INSERT INTO public.minutes_participants (
        minute_id,
        user_id,
        name_snapshot,
        position_snapshot,
        org_unit_id,
        org_unit_name_snapshot,
        invitation_status,
        attendance_status,
        notes
      ) VALUES (
        v_minute_id,
        v_p_user_id,
        v_p_name,
        v_p_position,
        v_p_org_unit_id,
        v_p_org_unit_name,
        v_p_inv_status,
        v_p_att_status,
        v_p_notes
      );
    END LOOP;
  END IF;

  -- Step 14: INSERT external participants (invitation_status always 'invited')
  IF v_external_parts IS NOT NULL THEN
    FOR i IN 0..jsonb_array_length(v_external_parts) - 1 LOOP
      v_part := v_external_parts->i;

      v_ep_full_name    := v_part->>'full_name';
      v_ep_organization := v_part->>'organization';
      v_ep_position     := v_part->>'position';
      v_ep_mobile       := v_part->>'mobile';
      v_ep_email        := v_part->>'email';
      v_ep_att_status   := v_part->>'attendance_status';
      v_ep_notes        := v_part->>'notes';

      INSERT INTO public.minutes_external_participants (
        minute_id,
        full_name,
        organization,
        position,
        mobile,
        email,
        invitation_status,
        attendance_status,
        notes
      ) VALUES (
        v_minute_id,
        v_ep_full_name,
        v_ep_organization,
        v_ep_position,
        v_ep_mobile,
        v_ep_email,
        'invited',
        v_ep_att_status,
        v_ep_notes
      );
    END LOOP;
  END IF;

  -- Step 15: INSERT agenda results
  IF v_agenda_arr IS NOT NULL THEN
    FOR i IN 0..jsonb_array_length(v_agenda_arr) - 1 LOOP
      v_agenda := v_agenda_arr->i;

      v_a_item_id     := NULLIF(v_agenda->>'meeting_agenda_item_id', '')::uuid;
      v_a_sort_order  := COALESCE((v_agenda->>'sort_order_snapshot')::int, 0);
      v_a_title       := v_agenda->>'agenda_title_snapshot';
      v_a_desc        := v_agenda->>'agenda_description_snapshot';
      v_a_presenter   := v_agenda->>'presenter_snapshot';
      v_a_alloc_min   := (v_agenda->>'allocated_minutes_snapshot')::int;
      v_a_discussion  := v_agenda->>'discussion_result';
      v_a_result_type := v_agenda->>'result_type';
      v_a_add_notes   := v_agenda->>'additional_notes';

      INSERT INTO public.minutes_agenda_results (
        minute_id,
        meeting_agenda_item_id,
        sort_order_snapshot,
        agenda_title_snapshot,
        agenda_description_snapshot,
        presenter_snapshot,
        allocated_minutes_snapshot,
        discussion_result,
        result_type,
        additional_notes
      ) VALUES (
        v_minute_id,
        v_a_item_id,
        v_a_sort_order,
        v_a_title,
        v_a_desc,
        v_a_presenter,
        v_a_alloc_min,
        v_a_discussion,
        v_a_result_type,
        v_a_add_notes
      );
    END LOOP;
  END IF;

  -- Step 16: Return success
  RETURN jsonb_build_object(
    'success', true,
    'minute_id', v_minute_id,
    'message', 'Draft created successfully'
  );

  -- ==========================================================
  -- Exception Handlers (exact order)
  -- ==========================================================

  EXCEPTION
    -- Handler 1: unique_violation
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;

      IF v_constraint_name = 'minutes_meeting_id_key' THEN
        -- تکرار meeting_id در جدول minutes
        RETURN jsonb_build_object(
          'success', false,
          'minute_id', null,
          'error_code', 'MINUTES_ALREADY_EXISTS',
          'sqlstate', '23505',
          'message', 'برای این جلسه قبلاً صورت‌جلسه ثبت شده است'
        );

      ELSIF v_constraint_name = 'minutes_participants_minute_user_unique' THEN
        -- تکرار (minute_id, user_id) در شرکت‌کنندگان داخلی
        RETURN jsonb_build_object(
          'success', false,
          'minute_id', null,
          'error_code', 'DUPLICATE_INTERNAL_PARTICIPANT',
          'sqlstate', '23505',
          'message', 'این شرکت‌کننده قبلاً اضافه شده است'
        );

      ELSIF v_constraint_name = 'minutes_agenda_results_minute_agenda_unique' THEN
        -- تکرار (minute_id, meeting_agenda_item_id) در نتایج دستور جلسه
        RETURN jsonb_build_object(
          'success', false,
          'minute_id', null,
          'error_code', 'DUPLICATE_AGENDA_ITEM',
          'sqlstate', '23505',
          'message', 'این دستور جلسه قبلاً اضافه شده است'
        );

      ELSE
        -- سایر unique violationها — بدون افشای SQLERRM
        RETURN jsonb_build_object(
          'success', false,
          'minute_id', null,
          'error_code', 'INTERNAL_ERROR',
          'sqlstate', '23505',
          'message', 'خطای داخلی در ذخیره پیش‌نویس'
        );
      END IF;

    -- Handler 2: SQLSTATE 'P0001' (business validation errors)
    WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_msg_text = MESSAGE_TEXT;
      RETURN jsonb_build_object(
        'success', false,
        'minute_id', null,
        'error_code', v_msg_text,
        'sqlstate', 'P0001',
        'message', v_msg_text
      );

    -- Handler 3: Payload / Cast / DataType errors
    WHEN invalid_text_representation
         OR numeric_value_out_of_range
         OR datatype_mismatch THEN
      GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
      RETURN jsonb_build_object(
        'success', false,
        'minute_id', null,
        'error_code', 'PAYLOAD_INVALID',
        'sqlstate', v_diag_sqlstate,
        'message', 'ساختار اطلاعات ارسالی معتبر نیست'
      );

    -- Handler 4: All other unknown errors
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
      RETURN jsonb_build_object(
        'success', false,
        'minute_id', null,
        'error_code', 'INTERNAL_ERROR',
        'sqlstate', v_diag_sqlstate,
        'message', 'خطای داخلی در ذخیره پیش‌نویس'
      );
END;
$$;

REVOKE ALL ON FUNCTION public.create_minutes_draft(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_minutes_draft(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_minutes_draft(jsonb) TO authenticated;
