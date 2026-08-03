/*
# Minutes Decisions — Five Fixes

## Problem 1: Decision counts under RLS
MinutesListPage reads minutes_decisions directly under RLS, getting partial counts.
Fix: New RPC get_minutes_decision_counts that counts ALL decisions for visible minutes.

## Problem 2: Combined update action
No schema change needed — update_my_minutes_decision already accepts p_status + p_progress_percent + p_report_text.

## Problem 3: Non-destructive decision sync + full edit load
_sync_minutes_decisions currently DELETEs all decisions then re-inserts from payload.
If RLS returns partial decisions, the missing ones are lost.
Fix: Redefine _sync_minutes_decisions to be non-destructive (update by id, insert new, delete only explicitly specified ids).
New RPC get_minutes_decisions_for_edit returns ALL decisions for a minute regardless of owner.

## Problem 4: Followup page fixes
manage_minutes_decision has:
- Ambiguous column references (status, id, updated_at without alias)
- Wrong notification event: decision_followup_logged instead of decision_followup
- Missing AT TIME ZONE fix for p_remind_at validation
- Missing PG_EXCEPTION_DETAIL/HINT in error handler
Fix: Redefine manage_minutes_decision with explicit aliases and corrected logic.

## Problem 5: External responsible party
New columns on minutes_decisions for external responsible party support.

## Safety
- No existing migration edited
- No data deleted/reset/truncated
- No new CASCADE
- All new RPCs: SECURITY DEFINER, SET search_path='', REVOKE from PUBLIC/anon, GRANT to authenticated
*/

-- ════════════════════════════════════════════════════════════════════════════
-- 1. External responsible party columns on minutes_decisions
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.minutes_decisions
  ADD COLUMN IF NOT EXISTS responsible_party_type text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS external_responsible_participant_id uuid,
  ADD COLUMN IF NOT EXISTS external_responsible_name_snapshot text,
  ADD COLUMN IF NOT EXISTS external_responsible_organization_snapshot text,
  ADD COLUMN IF NOT EXISTS external_responsible_position_snapshot text;

-- FK to external participants with ON DELETE SET NULL (never delete the decision)
ALTER TABLE public.minutes_decisions
  DROP CONSTRAINT IF EXISTS minutes_decisions_external_responsible_fk;
ALTER TABLE public.minutes_decisions
  ADD CONSTRAINT minutes_decisions_external_responsible_fk
  FOREIGN KEY (external_responsible_participant_id)
  REFERENCES public.minutes_external_participants(id)
  ON DELETE SET NULL;

-- CHECK constraint for responsible_party_type
ALTER TABLE public.minutes_decisions
  DROP CONSTRAINT IF EXISTS minutes_decisions_responsible_party_type_check;
ALTER TABLE public.minutes_decisions
  ADD CONSTRAINT minutes_decisions_responsible_party_type_check
  CHECK (responsible_party_type IN ('internal', 'external'));

-- Compatibility constraint: external fields required when type=external
ALTER TABLE public.minutes_decisions
  DROP CONSTRAINT IF EXISTS minutes_decisions_external_responsible_check;
ALTER TABLE public.minutes_decisions
  ADD CONSTRAINT minutes_decisions_external_responsible_check
  CHECK (
    (responsible_party_type = 'internal' AND external_responsible_name_snapshot IS NULL)
    OR
    (responsible_party_type = 'external' AND external_responsible_name_snapshot IS NOT NULL)
  );

-- Backfill existing rows to 'internal'
UPDATE public.minutes_decisions SET responsible_party_type = 'internal' WHERE responsible_party_type IS NULL OR responsible_party_type = '';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. get_minutes_decision_counts — read-only RPC for accurate counts
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_minutes_decision_counts(
  p_minute_ids uuid[]
)
RETURNS TABLE(minute_id uuid, decision_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT d.minute_id, count(*)::bigint AS decision_count
  FROM public.minutes_decisions d
  WHERE d.minute_id = ANY(p_minute_ids)
  AND d.minute_id IN (
    SELECT m.id FROM public.minutes m
    WHERE public._user_can_view_minute(m.id)
  )
  GROUP BY d.minute_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_minutes_decision_counts(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_minutes_decision_counts(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_minutes_decision_counts(uuid[]) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. get_minutes_decisions_for_edit — full decision load for edit form
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_minutes_decisions_for_edit(
  p_minute_id uuid
)
RETURNS TABLE(
  id uuid,
  agenda_result_id uuid,
  meeting_agenda_item_id uuid,
  title text,
  description text,
  primary_owner_user_id uuid,
  responsible_unit_id uuid,
  responsible_unit_name_snapshot text,
  priority text,
  status text,
  progress_percent integer,
  start_date date,
  due_date date,
  completed_at timestamptz,
  requires_followup boolean,
  latest_update text,
  created_by_user_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  discussion_result text,
  result_type text,
  additional_notes text,
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
DECLARE
  v_user_id uuid := auth.uid();
  v_minute_status text;
  v_created_by uuid;
  v_secretary_id uuid;
  v_chair_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT m.status, m.created_by_user_id, m.secretary_user_id, m.chair_user_id
  INTO v_minute_status, v_created_by, v_secretary_id, v_chair_id
  FROM public.minutes m
  WHERE m.id = p_minute_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_minute_status NOT IN ('draft', 'changes_requested') THEN
    RAISE EXCEPTION 'MINUTE_NOT_EDITABLE' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    public.is_current_user_admin()
    OR v_created_by = v_user_id
    OR v_secretary_id = v_user_id
    OR v_chair_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'MINUTES_NO_PERMISSION' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    d.id AS id,
    d.agenda_result_id AS agenda_result_id,
    ar.meeting_agenda_item_id AS meeting_agenda_item_id,
    d.title AS title,
    d.description AS description,
    d.primary_owner_user_id AS primary_owner_user_id,
    d.responsible_unit_id AS responsible_unit_id,
    d.responsible_unit_name_snapshot AS responsible_unit_name_snapshot,
    d.priority AS priority,
    d.status AS status,
    d.progress_percent AS progress_percent,
    d.start_date AS start_date,
    d.due_date AS due_date,
    d.completed_at AS completed_at,
    d.requires_followup AS requires_followup,
    d.latest_update AS latest_update,
    d.created_by_user_id AS created_by_user_id,
    d.created_at AS created_at,
    d.updated_at AS updated_at,
    d.discussion_result AS discussion_result,
    d.result_type AS result_type,
    d.additional_notes AS additional_notes,
    d.responsible_party_type AS responsible_party_type,
    d.external_responsible_participant_id AS external_responsible_participant_id,
    d.external_responsible_name_snapshot AS external_responsible_name_snapshot,
    d.external_responsible_organization_snapshot AS external_responsible_organization_snapshot,
    d.external_responsible_position_snapshot AS external_responsible_position_snapshot
  FROM public.minutes_decisions d
  LEFT JOIN public.minutes_agenda_results ar ON ar.id = d.agenda_result_id
  WHERE d.minute_id = p_minute_id
  ORDER BY d.created_at ASC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_minutes_decisions_for_edit(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_minutes_decisions_for_edit(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_minutes_decisions_for_edit(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Non-destructive _sync_minutes_decisions
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._sync_minutes_decisions(
  p_minute_id uuid,
  p_decisions jsonb
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
  v_responsible_party_type text;
  v_ext_participant_id uuid;
  v_ext_name       text;
  v_ext_org        text;
  v_ext_position   text;
  v_existing       RECORD;
  v_existing_status_val text;
  v_existing_progress int;
  v_existing_completed timestamptz;
  v_existing_update text;
  v_existing_owner uuid;
  v_payload_ids    uuid[] := '{}'::uuid[];
  v_deleted_ids    uuid[] := '{}'::uuid[];
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

      -- For internal: primary_owner_user_id is required
      -- For external: external_responsible_name_snapshot is required, primary_owner_user_id can be null
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

  -- Collect payload IDs (decisions that have an id)
  IF jsonb_array_length(v_arr) > 0 THEN
    FOR i IN 0..jsonb_array_length(v_arr) - 1 LOOP
      v_dec := v_arr->i;
      v_dec_id := NULLIF(v_dec->>'id', '')::uuid;
      IF v_dec_id IS NOT NULL THEN
        v_payload_ids := array_append(v_payload_ids, v_dec_id);
      END IF;
    END LOOP;
  END IF;

  -- Collect explicitly deleted decision IDs
  v_deleted_ids := COALESCE(
    (SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(p_decisions->'deleted_decision_ids') AS x),
    '{}'::uuid[]
  );

  -- Process each decision in payload: UPDATE existing or INSERT new
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
        -- UPDATE existing decision — preserve status, progress, completed_at, latest_update, created_by_user_id
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
        -- INSERT new decision
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
  FOREACH v_delete_id IN ARRAY v_deleted_ids LOOP
    DELETE FROM public.minutes_decisions
    WHERE id = v_delete_id AND minute_id = p_minute_id;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Redefined manage_minutes_decision with explicit aliases and fixes
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.manage_minutes_decision(
  p_decision_id uuid,
  p_expected_updated_at timestamptz,
  p_operation text,
  p_new_status text DEFAULT NULL,
  p_event_title text DEFAULT NULL,
  p_report_text text DEFAULT NULL,
  p_event_metadata jsonb DEFAULT '{}'::jsonb,
  p_obstacle_update_id uuid DEFAULT NULL,
  p_remind_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id          uuid := auth.uid();
  v_decision         public.minutes_decisions%ROWTYPE;
  v_minute_id        uuid;
  v_minute_status    text;
  v_minute_published_at timestamptz;
  v_secretary_id     uuid;
  v_chair_id         uuid;
  v_created_by       uuid;
  v_revision         integer;
  v_is_owner         boolean;
  v_is_manager       boolean;
  v_allowed          boolean := false;
  v_event_type       text;
  v_is_blocking      boolean := false;
  v_new_status       text;
  v_new_completed_at timestamptz;
  v_new_updated_at   timestamptz;
  v_obstacle_exists  boolean;
  v_update_id        uuid;
  v_recipient        uuid;
  v_audience         text;
  v_seen             uuid[] := '{}'::uuid[];
  v_notif_event_type text;
  v_notif_title      text;
  v_notif_msg        text;
  v_event_key        text;
  v_msg_text         text;
  v_actor_name       text;
  v_owner_name       text;
  v_obstacle_title   text;
  v_diag_sqlstate    text;
  v_diag_msg         text;
  v_diag_detail      text;
  v_diag_hint        text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF p_operation NOT IN ('status_change','followup','obstacle','obstacle_resolved','reopened','completion') THEN
    RAISE EXCEPTION 'INVALID_OPERATION' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the decision row with explicit alias
  SELECT * INTO v_decision
  FROM public.minutes_decisions d
  WHERE d.id = p_decision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DECISION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Optimistic concurrency with explicit alias
  IF p_expected_updated_at IS NOT NULL AND v_decision.updated_at IS NOT NULL
     AND v_decision.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'DECISION_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  -- Fetch minute metadata with explicit aliases
  SELECT m.status, m.published_at, m.secretary_user_id, m.chair_user_id, m.created_by_user_id, m.revision_number
  INTO v_minute_status, v_minute_published_at, v_secretary_id, v_chair_id, v_created_by, v_revision
  FROM public.minutes m
  WHERE m.id = v_decision.minute_id;

  v_is_owner := (v_decision.primary_owner_user_id = v_user_id);

  -- Permission check with explicit aliases
  IF p_operation IN ('status_change', 'obstacle', 'obstacle_resolved', 'reopened', 'completion') THEN
    v_is_manager := (
      public.is_current_user_admin()
      OR v_created_by = v_user_id
      OR v_secretary_id = v_user_id
      OR v_chair_id = v_user_id
    );
    v_allowed := v_is_owner OR v_is_manager;
  ELSIF p_operation IN ('followup') THEN
    v_is_manager := (
      public.is_current_user_admin()
      OR v_created_by = v_user_id
      OR v_secretary_id = v_user_id
      OR v_chair_id = v_user_id
    );
    v_allowed := v_is_manager;
    IF NOT v_allowed THEN
      RAISE EXCEPTION 'MINUTES_DECISION_TRACKING_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Validate obstacle title
  IF p_operation = 'obstacle' AND (p_event_title IS NULL OR btrim(p_event_title) = '') THEN
    RAISE EXCEPTION 'OBSTACLE_TITLE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  -- Reminder validation: p_remind_at is already timestamptz, compare directly
  IF p_remind_at IS NOT NULL THEN
    IF p_remind_at <= now() THEN
      RAISE EXCEPTION 'REMINDER_MUST_BE_FUTURE' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Determine event type
  v_event_type := CASE p_operation
    WHEN 'status_change' THEN 'status_change'
    WHEN 'followup' THEN 'followup'
    WHEN 'obstacle' THEN 'obstacle'
    WHEN 'obstacle_resolved' THEN 'obstacle_resolved'
    WHEN 'reopened' THEN 'reopened'
    WHEN 'completion' THEN 'completion'
  END;

  v_is_blocking := (p_operation = 'obstacle');
  v_new_status := v_decision.status::text;
  v_new_completed_at := v_decision.completed_at;

  -- Status change logic with explicit aliases
  IF p_operation = 'status_change' THEN
    IF p_new_status IS NULL THEN
      RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001';
    END IF;
    IF p_new_status NOT IN ('not_started','planned','in_progress','waiting_coordination','waiting_approval','completed','stopped') THEN
      RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001';
    END IF;
    v_new_status := p_new_status;
    IF p_new_status = 'completed' THEN
      v_new_completed_at := now();
    ELSIF p_new_status <> 'completed' THEN
      v_new_completed_at := NULL;
    END IF;
  ELSIF p_operation = 'completion' THEN
    IF v_decision.progress_percent < 100 THEN
      RAISE EXCEPTION 'COMPLETION_REQUIRES_100_PERCENT' USING ERRCODE = 'P0001';
    END IF;
    v_new_status := 'completed';
    v_new_completed_at := now();
  ELSIF p_operation = 'reopened' THEN
    IF v_decision.status NOT IN ('completed','stopped') THEN
      RAISE EXCEPTION 'INVALID_REOPEN_STATUS' USING ERRCODE = 'P0001';
    END IF;
    v_new_status := 'in_progress';
    v_new_completed_at := NULL;
  END IF;

  -- Prevent editing completed decisions (except reopen/obstacle_resolved)
  IF v_decision.status = 'completed' AND p_operation NOT IN ('reopened','obstacle_resolved') THEN
    RAISE EXCEPTION 'COMPLETED_DECISION_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  -- Validate obstacle_resolved
  IF p_operation = 'obstacle_resolved' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.minutes_decision_updates u
      WHERE u.id = p_obstacle_update_id
      AND u.decision_id = p_decision_id
      AND u.event_type = 'obstacle'
      AND u.is_blocking = true
      AND u.resolved_at IS NULL
    ) INTO v_obstacle_exists;
    IF NOT v_obstacle_exists THEN
      RAISE EXCEPTION 'OBSTACLE_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Update the decision with explicit aliases
  v_new_updated_at := now();
  UPDATE public.minutes_decisions d
  SET
    d.status = v_new_status::public.decision_status,
    d.completed_at = v_new_completed_at,
    d.latest_update = COALESCE(p_report_text, d.latest_update),
    d.updated_at = v_new_updated_at
  WHERE d.id = p_decision_id;

  -- Insert update record with explicit aliases
  INSERT INTO public.minutes_decision_updates (
    decision_id, minute_id, previous_status, new_status,
    previous_progress_percent, new_progress_percent,
    update_text, event_type, event_title, event_metadata, is_blocking,
    created_by_user_id
  ) VALUES (
    p_decision_id, v_decision.minute_id, v_decision.status::text, v_new_status,
    v_decision.progress_percent, v_decision.progress_percent,
    COALESCE(p_report_text, p_event_title, ''),
    v_event_type, p_event_title, p_event_metadata, v_is_blocking, v_user_id
  )
  RETURNING id INTO v_update_id;

  -- Resolve obstacle
  IF p_operation = 'obstacle_resolved' THEN
    UPDATE public.minutes_decision_updates u
    SET u.resolved_at = now(), u.resolved_by_user_id = v_user_id
    WHERE u.id = p_obstacle_update_id;
  END IF;

  -- Insert reminder
  IF p_remind_at IS NOT NULL THEN
    v_recipient := v_decision.primary_owner_user_id;
    IF v_recipient IS NULL THEN
      RAISE EXCEPTION 'NO_REMINDER_RECIPIENT' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.minutes_decision_reminders (
      decision_id, minute_id, recipient_user_id,
      remind_at, status, created_by_user_id, source_update_id
    ) VALUES (
      p_decision_id, v_decision.minute_id, v_recipient,
      p_remind_at, 'pending', v_user_id, v_update_id
    );
  END IF;

  -- Get actor name
  v_actor_name := COALESCE(
    (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles_public p WHERE p.user_id = v_user_id LIMIT 1),
    (SELECT NULLIF(btrim(p.username), '') FROM public.profiles_public p WHERE p.user_id = v_user_id LIMIT 1),
    'کاربر'
  );

  -- Notifications for status_change, followup, reopened
  IF p_operation IN ('status_change','followup','reopened') THEN
    IF v_decision.primary_owner_user_id IS NOT NULL
       AND v_decision.primary_owner_user_id IS DISTINCT FROM v_user_id THEN
      v_owner_name := COALESCE(
        (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles p WHERE p.user_id = v_decision.primary_owner_user_id LIMIT 1),
        'مسئول مصوبه'
      );

      -- Fixed: use decision_followup instead of decision_followup_logged
      v_notif_event_type := CASE p_operation
        WHEN 'status_change' THEN 'decision_status_changed'
        WHEN 'followup' THEN 'decision_followup'
        WHEN 'reopened' THEN 'decision_reopened'
      END;

      v_notif_title := CASE p_operation
        WHEN 'status_change' THEN 'تغییر وضعیت مصوبه'
        WHEN 'followup' THEN 'پیگیری مصوبه'
        WHEN 'reopened' THEN 'بازگشایی مصوبه'
      END;

      v_notif_msg := v_actor_name || ' — ' || COALESCE(v_decision.title, 'مصوبه');

      -- Unique event key for dedup
      v_event_key := 'decision:' || p_decision_id::text || ':' || v_event_type || ':' || v_update_id::text || ':' || v_decision.primary_owner_user_id::text;

      -- Build context with all required placeholders
      PERFORM public._create_minutes_notification(
        v_decision.primary_owner_user_id,
        v_notif_event_type,
        v_notif_title,
        v_notif_msg,
        'decision',
        p_decision_id,
        v_decision.minute_id,
        v_revision,
        v_user_id,
        jsonb_build_object(
          'audience', 'decision_owner',
          'decision_title', COALESCE(v_decision.title, ''),
          'followup_method', COALESCE(p_event_metadata->>'method', ''),
          'followup_result', COALESCE(p_event_metadata->>'result', COALESCE(p_report_text, '')),
          'followup_date', COALESCE(p_event_metadata->>'next_followup_date', ''),
          'actor_name', v_actor_name,
          'decision_link', '#minutes-detail?minute=' || v_decision.minute_id::text,
          'decision_owner_name', v_owner_name
        ),
        v_event_key
      );
    END IF;
  END IF;

  -- Notifications for obstacle, obstacle_resolved, completion
  IF p_operation IN ('obstacle','obstacle_resolved','completion') THEN
    FOREACH v_recipient IN ARRAY ARRAY[
      v_decision.primary_owner_user_id, v_created_by, v_secretary_id, v_chair_id
    ] LOOP
      IF v_recipient IS NULL THEN CONTINUE; END IF;
      IF v_recipient = v_user_id THEN CONTINUE; END IF;
      IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
      v_seen := array_append(v_seen, v_recipient);

      v_audience := CASE
        WHEN v_recipient = v_decision.primary_owner_user_id THEN 'decision_owner'
        WHEN v_recipient = v_created_by THEN 'creator'
        WHEN v_recipient = v_secretary_id THEN 'secretary'
        WHEN v_recipient = v_chair_id THEN 'chair'
        ELSE 'other'
      END;

      v_notif_event_type := CASE p_operation
        WHEN 'obstacle' THEN 'decision_obstacle'
        WHEN 'obstacle_resolved' THEN 'decision_obstacle_resolved'
        WHEN 'completion' THEN 'decision_completed'
      END;

      v_notif_title := CASE p_operation
        WHEN 'obstacle' THEN 'ثبت مانع برای مصوبه'
        WHEN 'obstacle_resolved' THEN 'رفع مانع مصوبه'
        WHEN 'completion' THEN 'تکمیل مصوبه'
      END;

      v_notif_msg := v_actor_name || ' — ' || COALESCE(v_decision.title, 'مصوبه');

      v_event_key := 'decision:' || p_decision_id::text || ':' || v_event_type || ':' || v_update_id::text || ':' || v_recipient::text;

      PERFORM public._create_minutes_notification(
        v_recipient,
        v_notif_event_type,
        v_notif_title,
        v_notif_msg,
        'decision',
        p_decision_id,
        v_decision.minute_id,
        v_revision,
        v_user_id,
        jsonb_build_object(
          'audience', v_audience,
          'decision_title', COALESCE(v_decision.title, ''),
          'actor_name', v_actor_name,
          'decision_link', '#minutes-detail?minute=' || v_decision.minute_id::text
        ),
        v_event_key
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'updated_at', v_new_updated_at::text,
    'new_status', v_new_status,
    'update_id', v_update_id::text
  );

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_diag_msg = MESSAGE_TEXT;
    RETURN jsonb_build_object(
      'success', false,
      'error_code', v_diag_msg,
      'message', v_diag_msg
    );
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_diag_sqlstate = RETURNED_SQLSTATE,
      v_diag_msg = MESSAGE_TEXT,
      v_diag_detail = PG_EXCEPTION_DETAIL,
      v_diag_hint = PG_EXCEPTION_HINT;
    -- Log the full error server-side
    RAISE LOG 'manage_minutes_decision internal error: sqlstate=%, msg=%, detail=%, hint=%',
      v_diag_sqlstate, v_diag_msg, v_diag_detail, v_diag_hint;
    -- Return generic message with sqlstate for diagnosis
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'INTERNAL_ERROR',
      'sqlstate', v_diag_sqlstate,
      'message', 'خطای داخلی در مدیریت مصوبه'
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, timestamptz, text, text, text, text, jsonb, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, timestamptz, text, text, text, text, jsonb, uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, timestamptz, text, text, text, text, jsonb, uuid, timestamptz) TO authenticated;
