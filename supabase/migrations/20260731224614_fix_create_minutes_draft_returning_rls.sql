/*
# Fix create_minutes_draft RETURNING RLS failure

## Problem
`public.create_minutes_draft(jsonb)` inserts into `public.minutes` using:

    INSERT INTO public.minutes (...) VALUES (...) RETURNING id INTO v_minute_id;

The `RETURNING` clause causes PostgreSQL to evaluate the `minutes_select` RLS
policy on the newly inserted row. The function runs as `SECURITY INVOKER`
(the `authenticated` caller), and the SELECT policy check fails with
`new row violates row-level security policy for table "minutes"` — even though
the INSERT's WITH CHECK policy passes.

Reproduced:
- INSERT without RETURNING → succeeds
- INSERT with RETURNING id  → RLS error 42501

## Fix
1. Pre-generate the minute id: `v_minute_id := gen_random_uuid();`
2. Include `id` explicitly in the INSERT column list and VALUES.
3. Remove `RETURNING id INTO v_minute_id;`

The rest of the function is unchanged. `v_minute_id` is already used for all
downstream inserts (participants, external participants, agenda) and for the
final return value.

## Security
- No RLS policies are changed.
- No grants are changed.
- `create_minutes_draft` stays `SECURITY INVOKER`.
- No other functions are touched.
- No data is changed or deleted.
*/

CREATE OR REPLACE FUNCTION public.create_minutes_draft(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
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

-- Validate approval_mode: only system, in_person, or NULL
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

-- Pre-generate the minute id so we can avoid RETURNING (which triggers
-- the minutes_select RLS policy on the newly inserted row and fails).
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
v_ep_full_name := v_part->>'full_name';
v_ep_organization := v_part->>'organization';
v_ep_position := v_part->>'position';
v_ep_mobile := v_part->>'mobile';
v_ep_email := v_part->>'email';
v_ep_att_status := v_part->>'attendance_status';
v_ep_notes := v_part->>'notes';

INSERT INTO public.minutes_external_participants (
minute_id, full_name, organization, position, mobile, email,
attendance_status, notes
) VALUES (
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

RETURN jsonb_build_object('success', true, 'minute_id', v_minute_id);
EXCEPTION WHEN OTHERS THEN
v_msg_text := SQLERRM;
v_diag_sqlstate := SQLSTATE;
RETURN jsonb_build_object('success', false, 'error_code', v_msg_text, 'message', v_msg_text);
END;
$function$;
