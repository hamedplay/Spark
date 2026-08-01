/*
# Restrict Decision Tracking to Secretary Only

## Purpose
Per product decision, the "decision tracking" (پیگیری مصوبات) feature must only be
accessible to the secretary of the same minute (صورت‌جلسه). No other role — including
admin, chair, creator, or users with the `minutes_decisions.track` permission — may
access tracking data or perform tracking operations.

## Changes

### 1. `_can_track_decisions(p_minute_id uuid)` — rewritten
Previously allowed: admin OR secretary OR chair OR creator OR has_permission('minutes_decisions.track')
Now allows ONLY: `secretary_user_id = auth.uid()`

This is the core gate function used by:
- `get_trackable_minutes_decisions`
- `get_trackable_minutes_decisions_summary`
- `has_any_trackable_minutes_decision`

### 2. `manage_minutes_decision` — authorization tightened
Previously `v_is_manager` was: admin OR secretary OR chair OR creator
Now `v_is_manager` is: `secretary_user_id = auth.uid()` only

Owner operations (`update_my_minutes_decision`) are NOT changed — decision owners
can still update their own decisions via the owner RPC.

### 3. No RLS policy changes
RLS on tracking tables is not changed. The tracking RPCs are SECURITY DEFINER functions
that enforce access via `_can_track_decisions`. Owner access via `update_my_minutes_decision`
continues to work through its own authorization.

### 4. No destructive operations
No tables dropped, no columns removed, no data lost. Only function definitions changed.

## Important Notes
1. Admin users no longer bypass tracking restrictions.
2. The `minutes_decisions.track` permission key still exists for menu visibility but
   no longer grants tracking access at the DB level.
3. Chair, creator, and participants cannot track decisions.
4. Decision owners can still use "My Decisions" (مصوبات من) via `update_my_minutes_decision`.
*/

-- ─── 1. Rewrite _can_track_decisions: secretary-only ────────────────────────────

CREATE OR REPLACE FUNCTION public._can_track_decisions(p_minute_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT EXISTS (
  SELECT 1 FROM public.minutes m
  WHERE m.id = p_minute_id
    AND m.secretary_user_id = auth.uid()
);
$function$;

-- ─── 2. Tighten manage_minutes_decision: v_is_manager = secretary-only ──────────
-- We use CREATE OR REPLACE to update the function body. The full body is redefined
-- with only the v_is_manager line changed (secretary-only, no admin/chair/creator bypass).

CREATE OR REPLACE FUNCTION public.manage_minutes_decision(
  p_decision_id uuid,
  p_expected_updated_at timestamp with time zone,
  p_operation text,
  p_new_status text DEFAULT NULL::text,
  p_event_title text DEFAULT NULL::text,
  p_report_text text DEFAULT NULL::text,
  p_event_metadata jsonb DEFAULT '{}'::jsonb,
  p_obstacle_update_id uuid DEFAULT NULL::uuid,
  p_remind_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id          uuid := auth.uid();
  v_decision         public.minutes_decisions%ROWTYPE;
  v_minute_id        uuid;
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
  v_new_updated_at  timestamptz;
  v_obstacle_exists  boolean;
  v_update_id        uuid;
  v_recipient         uuid;
  v_audience          text;
  v_seen              uuid[] := '{}'::uuid[];
  v_notif_event_type text;
  v_notif_title       text;
  v_notif_msg         text;
  v_event_key         text;
  v_msg_text          text;
  v_remind_at_tz     timestamptz;
  v_actor_name       text;
  v_owner_name       text;
  v_obstacle_title   text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF p_operation NOT IN ('status_change','followup','obstacle','obstacle_resolved','reopened','completion') THEN
    RAISE EXCEPTION 'INVALID_OPERATION' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the decision row for safe concurrent updates
  SELECT * INTO v_decision
  FROM public.minutes_decisions
  WHERE id = p_decision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DECISION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Optimistic concurrency check
  IF p_expected_updated_at IS NOT NULL
     AND v_decision.updated_at IS NOT NULL
     AND v_decision.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'DECISION_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  -- Fetch minute context for authorization
  SELECT id, secretary_user_id, chair_user_id, created_by_user_id, revision_number
  INTO v_minute_id, v_secretary_id, v_chair_id, v_created_by, v_revision
  FROM public.minutes WHERE id = v_decision.minute_id;

  -- Authorization: owner checks ownership, manager checks secretary-only
  v_is_owner := v_decision.primary_owner_user_id IS NOT DISTINCT FROM v_user_id;
  -- Secretary-only manager access — admin, chair, creator no longer bypass
  v_is_manager := v_secretary_id IS NOT DISTINCT FROM v_user_id;

  -- Operation-level authorization
  IF p_operation IN ('obstacle', 'obstacle_resolved', 'completion') THEN
    v_allowed := v_is_owner OR v_is_manager;
  ELSIF p_operation IN ('status_change', 'followup', 'reopened') THEN
    v_allowed := v_is_manager;
  ELSE
    v_allowed := false;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Validate obstacle_title for obstacle operations
  IF p_operation = 'obstacle' THEN
    v_obstacle_title := COALESCE(p_event_title, p_event_metadata->>'obstacle_title');
    IF v_obstacle_title IS NULL OR btrim(v_obstacle_title) = '' THEN
      RAISE EXCEPTION 'OBSTACLE_TITLE_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Validate remind_at is in the future when provided
  IF p_remind_at IS NOT NULL THEN
    v_remind_at_tz := p_remind_at AT TIME ZONE 'Asia/Tehran';
    IF v_remind_at_tz <= now() THEN
      RAISE EXCEPTION 'REMINDER_MUST_BE_FUTURE' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Determine event type and blocking flag
  v_event_type := CASE p_operation
    WHEN 'status_change'   THEN 'status_change'
    WHEN 'followup'        THEN 'followup'
    WHEN 'obstacle'        THEN 'obstacle'
    WHEN 'obstacle_resolved' THEN 'obstacle_resolved'
    WHEN 'reopened'        THEN 'reopened'
    WHEN 'completion'      THEN 'completion'
  END;

  v_is_blocking := (p_operation = 'obstacle');

  -- Compute new status
  v_new_status := v_decision.status::text;
  v_new_completed_at := v_decision.completed_at;

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

  -- Check completed immutability
  IF v_decision.status = 'completed' AND p_operation NOT IN ('reopened','obstacle_resolved') THEN
    RAISE EXCEPTION 'COMPLETED_DECISION_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  -- For obstacle_resolved, verify the obstacle exists and is unresolved
  IF p_operation = 'obstacle_resolved' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.minutes_decision_updates
      WHERE id = p_obstacle_update_id
        AND decision_id = p_decision_id
        AND event_type = 'obstacle'
        AND is_blocking = true
        AND resolved_at IS NULL
    ) INTO v_obstacle_exists;
    IF NOT v_obstacle_exists THEN
      RAISE EXCEPTION 'OBSTACLE_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Update the decision
  v_new_updated_at := now();

  UPDATE public.minutes_decisions
  SET status = v_new_status::public.decision_status,
      completed_at = v_new_completed_at,
      latest_update = COALESCE(p_report_text, v_decision.latest_update),
      updated_at = v_new_updated_at
  WHERE id = p_decision_id;

  -- Create the update event record
  INSERT INTO public.minutes_decision_updates (
    decision_id, minute_id, previous_status, new_status,
    previous_progress_percent, new_progress_percent,
    update_text, event_type, event_title, event_metadata, is_blocking,
    created_by_user_id
  ) VALUES (
    p_decision_id, v_minute_id,
    v_decision.status::text, v_new_status,
    v_decision.progress_percent, v_decision.progress_percent,
    COALESCE(p_report_text, p_event_title, ''),
    v_event_type, p_event_title, p_event_metadata,
    v_is_blocking, v_user_id
  )
  RETURNING id INTO v_update_id;

  -- Resolve obstacle if applicable
  IF p_operation = 'obstacle_resolved' THEN
    UPDATE public.minutes_decision_updates
    SET resolved_at = now(), resolved_by_user_id = v_user_id
    WHERE id = p_obstacle_update_id;
  END IF;

  -- Create reminder if requested
  IF p_remind_at IS NOT NULL THEN
    v_recipient := v_decision.primary_owner_user_id;
    IF v_recipient IS NULL THEN
      RAISE EXCEPTION 'NO_REMINDER_RECIPIENT' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.minutes_decision_reminders (
      decision_id, minute_id, recipient_user_id,
      remind_at, status, created_by_user_id, source_update_id
    ) VALUES (
      p_decision_id, v_minute_id, v_recipient,
      p_remind_at, 'pending', v_user_id, v_update_id
    );
  END IF;

  -- ── Notifications ──────────────────────────────────────────────────────────
  v_actor_name := COALESCE(
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles_public WHERE user_id = v_user_id LIMIT 1),
    (SELECT NULLIF(btrim(username), '') FROM public.profiles_public WHERE user_id = v_user_id LIMIT 1),
    'کاربر'
  );

  -- For status_change/followup/reopened: notify the decision owner
  IF p_operation IN ('status_change','followup','reopened') THEN
    IF v_decision.primary_owner_user_id IS NOT NULL
       AND v_decision.primary_owner_user_id IS DISTINCT FROM v_user_id THEN
      v_owner_name := COALESCE(
        (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_decision.primary_owner_user_id LIMIT 1),
        'مسئول مصوبه'
      );
      v_event_key := 'decision:' || p_decision_id::text || ':' || v_event_type || ':' || v_update_id::text || ':' || v_decision.primary_owner_user_id::text;

      v_notif_event_type := CASE p_operation
        WHEN 'status_change' THEN 'decision_status_changed'
        WHEN 'followup'     THEN 'decision_followup_logged'
        WHEN 'reopened'     THEN 'decision_reopened'
      END;

      v_notif_title := CASE p_operation
        WHEN 'status_change' THEN 'تغییر وضعیت مصوبه'
        WHEN 'followup'     THEN 'پیگیری مصوبه'
        WHEN 'reopened'     THEN 'بازگشایی مصوبه'
      END;

      v_notif_msg := v_actor_name || ' — ' || COALESCE(v_decision.title, 'مصوبه');

      PERFORM public._create_minutes_notification(
        v_decision.primary_owner_user_id, v_notif_event_type, v_notif_title, v_notif_msg,
        'decision', p_decision_id, v_minute_id, v_revision
      );
    END IF;
  END IF;

  -- For obstacle/obstacle_resolved/completion: notify owner, creator, secretary, chair
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
        WHEN 'obstacle'          THEN 'decision_obstacle'
        WHEN 'obstacle_resolved' THEN 'decision_obstacle_resolved'
        WHEN 'completion'        THEN 'decision_completed'
      END;

      v_notif_title := CASE p_operation
        WHEN 'obstacle'          THEN 'ثبت مانع برای مصوبه'
        WHEN 'obstacle_resolved' THEN 'رفع مانع مصوبه'
        WHEN 'completion'        THEN 'تکمیل مصوبه'
      END;

      v_notif_msg := v_actor_name || ' — ' || COALESCE(v_decision.title, 'مصوبه');

      PERFORM public._create_minutes_notification(
        v_recipient, v_notif_event_type, v_notif_title, v_notif_msg,
        'decision', p_decision_id, v_minute_id, v_revision
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
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', SQLERRM,
      'message', SQLSTATE
    );
END;
$function$;

-- Revoke public/anon execution and grant only to authenticated
REVOKE ALL ON FUNCTION public.manage_minutes_decision(
  uuid, timestamp with time zone, text, text, text, text, jsonb, uuid, timestamp with time zone
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public._can_track_decisions(uuid) FROM PUBLIC;

-- Grant execute to authenticated only
GRANT EXECUTE ON FUNCTION public.manage_minutes_decision(
  uuid, timestamp with time zone, text, text, text, text, jsonb, uuid, timestamp with time zone
) TO authenticated;

GRANT EXECUTE ON FUNCTION public._can_track_decisions(uuid) TO authenticated;
