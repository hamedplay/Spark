
-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: decisions history columns, RLS, RPCs
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Extend minutes_decision_updates ───────────────────────────────────────
ALTER TABLE public.minutes_decision_updates
  ADD COLUMN IF NOT EXISTS event_type   text NOT NULL DEFAULT 'progress',
  ADD COLUMN IF NOT EXISTS event_title  text NULL,
  ADD COLUMN IF NOT EXISTS event_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_blocking  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_at  timestamptz NULL,
  ADD COLUMN IF NOT EXISTS resolved_by_user_id uuid NULL
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add CHECK constraint for valid event_type values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'minutes_decision_updates_event_type_check'
  ) THEN
    ALTER TABLE public.minutes_decision_updates
      ADD CONSTRAINT minutes_decision_updates_event_type_check
      CHECK (event_type IN (
        'progress','status_change','report','obstacle','obstacle_resolved',
        'followup','completion','reopened'
      ));
  END IF;
END $$;

-- Back-fill event_type for existing rows
UPDATE public.minutes_decision_updates
SET event_type = CASE
  WHEN previous_status IS NOT NULL
       AND previous_status IS DISTINCT FROM new_status
    THEN 'status_change'
  ELSE 'progress'
END
WHERE event_type = 'progress';

-- ── 2. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mdu_decision_id_created_at
  ON public.minutes_decision_updates (decision_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mdu_is_blocking
  ON public.minutes_decision_updates (decision_id, is_blocking, resolved_at)
  WHERE is_blocking = true;

CREATE INDEX IF NOT EXISTS idx_minutes_decisions_owner_status
  ON public.minutes_decisions (primary_owner_user_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_minutes_decisions_minute_id
  ON public.minutes_decisions (minute_id);

-- ── 3. Helper: _can_track_decisions ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._can_track_decisions(p_minute_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT
    public.is_current_user_admin()
    OR EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = p_minute_id
        AND (
          m.secretary_user_id  = auth.uid()
          OR m.chair_user_id   = auth.uid()
          OR m.created_by_user_id = auth.uid()
        )
    )
    OR public._has_permission(auth.uid(), 'minutes_decisions.track'::text);
$$;

GRANT EXECUTE ON FUNCTION public._can_track_decisions(uuid) TO authenticated;

-- ── 4. RLS policies on minutes_decision_updates ───────────────────────────────

CREATE POLICY mdu_select ON public.minutes_decision_updates
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.minutes_decisions d
      WHERE d.id = minutes_decision_updates.decision_id
        AND d.primary_owner_user_id = auth.uid()
    )
    OR public._can_track_decisions(minutes_decision_updates.minute_id)
  );

-- INSERT blocked for direct client calls — only RPCs (SECURITY DEFINER) can insert
CREATE POLICY mdu_insert ON public.minutes_decision_updates
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- UPDATE blocked — use RPC for obstacle resolution
CREATE POLICY mdu_update ON public.minutes_decision_updates
  FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

-- DELETE blocked — history is immutable
CREATE POLICY mdu_delete ON public.minutes_decision_updates
  FOR DELETE TO authenticated
  USING (false);

-- ── 5. Tighten minutes_decisions SELECT policy ────────────────────────────────
DROP POLICY IF EXISTS minutes_decisions_select ON public.minutes_decisions;

CREATE POLICY minutes_decisions_select ON public.minutes_decisions
  FOR SELECT TO authenticated
  USING (
    primary_owner_user_id = auth.uid()
    OR public._can_track_decisions(minute_id)
    OR EXISTS (
      SELECT 1 FROM public.minutes m WHERE m.id = minutes_decisions.minute_id
    )
  );

-- ── 6. RPC: get_my_minutes_decisions ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_minutes_decisions(
  p_status   text    DEFAULT NULL,
  p_limit    integer DEFAULT 20,
  p_offset   integer DEFAULT 0
)
RETURNS TABLE (
  id                           uuid,
  minute_id                    uuid,
  agenda_result_id             uuid,
  title                        text,
  description                  text,
  primary_owner_user_id        uuid,
  responsible_unit_id          uuid,
  responsible_unit_name_snapshot text,
  priority                     text,
  status                       text,
  progress_percent             integer,
  start_date                   date,
  due_date                     date,
  completed_at                 timestamptz,
  requires_followup            boolean,
  latest_update                text,
  created_by_user_id           uuid,
  created_at                   timestamptz,
  updated_at                   timestamptz,
  discussion_result            text,
  result_type                  text,
  additional_notes             text,
  minute_title                 text,
  minute_status                text,
  meeting_date_snapshot        text,
  overdue                      boolean,
  agenda_title                 text,
  total_count                  bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      d.id, d.minute_id, d.agenda_result_id,
      d.title, d.description,
      d.primary_owner_user_id,
      d.responsible_unit_id,
      d.responsible_unit_name_snapshot,
      d.priority::text, d.status::text, d.progress_percent,
      d.start_date, d.due_date, d.completed_at,
      d.requires_followup, d.latest_update,
      d.created_by_user_id, d.created_at, d.updated_at,
      d.discussion_result, d.result_type::text, d.additional_notes,
      m.meeting_title_snapshot   AS minute_title,
      m.status::text             AS minute_status,
      m.meeting_date_snapshot    AS meeting_date_snapshot,
      (d.due_date IS NOT NULL
        AND d.due_date < CURRENT_DATE
        AND d.status NOT IN ('completed','stopped')) AS overdue,
      NULL::text                 AS agenda_title
    FROM public.minutes_decisions d
    JOIN public.minutes m ON m.id = d.minute_id
    WHERE d.primary_owner_user_id = v_user_id
      AND (p_status IS NULL OR d.status::text = p_status)
    ORDER BY
      (d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE
       AND d.status NOT IN ('completed','stopped')) DESC,
      d.due_date ASC NULLS LAST,
      CASE d.priority
        WHEN 'urgent'    THEN 1
        WHEN 'important' THEN 2
        WHEN 'normal'    THEN 3
        WHEN 'low'       THEN 4
        ELSE 5
      END,
      d.updated_at DESC
  ),
  counted AS (SELECT COUNT(*) AS cnt FROM base)
  SELECT
    b.id, b.minute_id, b.agenda_result_id,
    b.title, b.description,
    b.primary_owner_user_id,
    b.responsible_unit_id, b.responsible_unit_name_snapshot,
    b.priority, b.status, b.progress_percent,
    b.start_date, b.due_date, b.completed_at,
    b.requires_followup, b.latest_update,
    b.created_by_user_id, b.created_at, b.updated_at,
    b.discussion_result, b.result_type, b.additional_notes,
    b.minute_title, b.minute_status, b.meeting_date_snapshot,
    b.overdue, b.agenda_title,
    c.cnt::bigint AS total_count
  FROM base b, counted c
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_minutes_decisions(text, integer, integer) TO authenticated;

-- ── 7. RPC: manage_minutes_decision ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manage_minutes_decision(
  p_decision_id        uuid,
  p_operation          text,
  p_new_status         text     DEFAULT NULL,
  p_event_title        text     DEFAULT NULL,
  p_report_text        text     DEFAULT NULL,
  p_event_metadata     jsonb    DEFAULT '{}'::jsonb,
  p_obstacle_update_id uuid     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id          uuid := auth.uid();
  v_decision         public.minutes_decisions%ROWTYPE;
  v_minute_status    text;
  v_minute_id        uuid;
  v_secretary_id     uuid;
  v_chair_id         uuid;
  v_created_by       uuid;
  v_is_manager       boolean;
  v_event_type       text;
  v_is_blocking      boolean := false;
  v_new_status       text;
  v_new_completed_at timestamptz;
  v_msg_text         text;
  v_diag_sqlstate    text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF p_operation NOT IN ('status_change','followup','obstacle','obstacle_resolved','reopened') THEN
    RAISE EXCEPTION 'INVALID_OPERATION' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_decision
  FROM public.minutes_decisions WHERE id = p_decision_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DECISION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, id, secretary_user_id, chair_user_id, created_by_user_id
  INTO v_minute_status, v_minute_id, v_secretary_id, v_chair_id, v_created_by
  FROM public.minutes WHERE id = v_decision.minute_id;

  v_is_manager :=
    public.is_current_user_admin()
    OR v_secretary_id = v_user_id
    OR v_chair_id     = v_user_id
    OR v_created_by   = v_user_id
    OR public._has_permission(v_user_id, 'minutes_decisions.track'::text);

  IF NOT v_is_manager THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF p_operation = 'status_change' THEN
    IF p_new_status IS NULL OR p_new_status NOT IN (
      'not_started','planned','in_progress','waiting_coordination',
      'waiting_approval','completed','stopped'
    ) THEN
      RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001';
    END IF;
    IF v_decision.status = 'completed' AND p_new_status <> 'completed' THEN
      RAISE EXCEPTION 'USE_REOPEN_OPERATION' USING ERRCODE = 'P0001';
    END IF;
    v_new_status := p_new_status;
    v_event_type := 'status_change';
    v_new_completed_at := CASE WHEN v_new_status = 'completed' THEN now() ELSE NULL END;
    UPDATE public.minutes_decisions SET
      status       = v_new_status,
      completed_at = v_new_completed_at,
      updated_at   = now()
    WHERE id = p_decision_id;

  ELSIF p_operation = 'reopened' THEN
    IF v_decision.status <> 'completed' THEN
      RAISE EXCEPTION 'DECISION_NOT_COMPLETED' USING ERRCODE = 'P0001';
    END IF;
    v_new_status := COALESCE(p_new_status, 'in_progress');
    IF v_new_status NOT IN ('not_started','planned','in_progress','waiting_coordination','waiting_approval') THEN
      RAISE EXCEPTION 'INVALID_REOPEN_STATUS' USING ERRCODE = 'P0001';
    END IF;
    v_event_type := 'reopened';
    UPDATE public.minutes_decisions SET
      status       = v_new_status,
      completed_at = NULL,
      updated_at   = now()
    WHERE id = p_decision_id;

  ELSIF p_operation = 'followup' THEN
    v_event_type := 'followup';

  ELSIF p_operation = 'obstacle' THEN
    v_event_type  := 'obstacle';
    v_is_blocking := true;

  ELSIF p_operation = 'obstacle_resolved' THEN
    v_event_type := 'obstacle_resolved';
    IF p_obstacle_update_id IS NOT NULL THEN
      UPDATE public.minutes_decision_updates SET
        resolved_at         = now(),
        resolved_by_user_id = v_user_id,
        event_type          = 'obstacle_resolved'
      WHERE id = p_obstacle_update_id
        AND decision_id = p_decision_id
        AND is_blocking = true
        AND resolved_at IS NULL;
    END IF;
  END IF;

  INSERT INTO public.minutes_decision_updates (
    decision_id, minute_id,
    previous_status, new_status,
    previous_progress_percent, new_progress_percent,
    update_text,
    event_type, event_title, event_metadata, is_blocking,
    created_by_user_id
  ) VALUES (
    p_decision_id, v_minute_id,
    v_decision.status,
    COALESCE(v_new_status, v_decision.status),
    v_decision.progress_percent, v_decision.progress_percent,
    p_report_text,
    v_event_type,
    p_event_title,
    COALESCE(p_event_metadata, '{}'::jsonb),
    v_is_blocking,
    v_user_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'operation', p_operation,
    'decision_id', p_decision_id
  );

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_msg_text = MESSAGE_TEXT;
    RETURN jsonb_build_object('success', false, 'error_code', v_msg_text, 'message', v_msg_text);
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
    RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
      'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در مدیریت مصوبه');
END;
$$;

GRANT EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, text, text, text, text, jsonb, uuid) TO authenticated;
