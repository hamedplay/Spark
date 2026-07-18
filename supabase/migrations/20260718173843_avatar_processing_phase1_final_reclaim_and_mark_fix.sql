/*
# Avatar Processing — Final Phase Migration

## Scope (only these 3 changes)
1. public.reclaim_avatar_jobs() -> integer
2. public.reclaim_avatar_cleanup_jobs() -> integer
3. Rewrite public.mark_avatar_cleanup_progress to use UPDATE ... RETURNING
   so the returned timestamps come from the stored row, not recomputed.

No other RPCs, buckets, edge functions, workers, or frontend changes.
*/

-- ============================================================================
-- 1. reclaim_avatar_jobs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reclaim_avatar_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reclaimed integer;
BEGIN
  WITH reclaimable AS (
    SELECT aj.id
    FROM public.avatar_jobs aj
    WHERE aj.status = 'processing'
      AND aj.heartbeat_at IS NOT NULL OR aj.started_at IS NOT NULL
      AND COALESCE(aj.heartbeat_at, aj.started_at) < now() - interval '180 seconds'
    FOR UPDATE
  )
  UPDATE public.avatar_jobs AS aj
     SET status         = CASE
           WHEN aj.attempt_count >= aj.max_attempts THEN 'failed'
           ELSE 'retry_wait'
         END,
         completed_at   = CASE
           WHEN aj.attempt_count >= aj.max_attempts THEN now()
           ELSE NULL
         END,
         next_retry_at  = CASE
           WHEN aj.attempt_count >= aj.max_attempts THEN NULL
           ELSE now() + make_interval(secs => 60 * aj.attempt_count)
         END,
         worker_id      = NULL,
         started_at     = NULL,
         heartbeat_at   = NULL,
         last_error     = 'reclaimed by reclaim_avatar_jobs (heartbeat expired)',
         updated_at     = now()
    FROM reclaimable
   WHERE aj.id = reclaimable.id;

  GET DIAGNOSTICS v_reclaimed = ROW_COUNT;
  RETURN v_reclaimed;
END;
$$;

REVOKE ALL ON FUNCTION public.reclaim_avatar_jobs()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_avatar_jobs()
  TO service_role;

-- ============================================================================
-- 2. reclaim_avatar_cleanup_jobs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reclaim_avatar_cleanup_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reclaimed integer;
BEGIN
  WITH reclaimable AS (
    SELECT aj.id
    FROM public.avatar_jobs aj
    WHERE aj.status = 'completed'
      AND aj.cleanup_status = 'processing'
      AND (aj.cleanup_heartbeat_at IS NOT NULL OR aj.cleanup_started_at IS NOT NULL)
      AND COALESCE(aj.cleanup_heartbeat_at, aj.cleanup_started_at)
          < now() - interval '180 seconds'
    FOR UPDATE
  )
  UPDATE public.avatar_jobs AS aj
     SET cleanup_status         = CASE
           WHEN aj.cleanup_attempt_count >= 3 THEN 'failed'
           ELSE 'pending'
         END,
         cleanup_next_retry_at = CASE
           WHEN aj.cleanup_attempt_count >= 3 THEN NULL
           ELSE now() + make_interval(secs => 60 * aj.cleanup_attempt_count)
         END,
         cleanup_worker_id      = NULL,
         cleanup_started_at     = NULL,
         cleanup_heartbeat_at   = NULL,
         cleanup_last_error     = 'reclaimed by reclaim_avatar_cleanup_jobs (cleanup heartbeat expired)',
         updated_at             = now()
    FROM reclaimable
   WHERE aj.id = reclaimable.id;

  GET DIAGNOSTICS v_reclaimed = ROW_COUNT;
  RETURN v_reclaimed;
END;
$$;

REVOKE ALL ON FUNCTION public.reclaim_avatar_cleanup_jobs()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_avatar_cleanup_jobs()
  TO service_role;

-- ============================================================================
-- 3. Rewrite mark_avatar_cleanup_progress to use UPDATE ... RETURNING
--    Logic is unchanged; returned timestamps now come from the stored row.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mark_avatar_cleanup_progress(
  p_job_id              uuid,
  p_cleanup_worker_id   text,
  p_old_deleted         boolean,
  p_quarantine_deleted  boolean
)
RETURNS TABLE (
  cleanup_status         text,
  old_avatar_deleted_at    timestamptz,
  quarantine_deleted_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status               text;
  v_cleanup_status       text;
  v_cleanup_worker_id    text;
  v_previous_avatar_path text;
  v_old_avatar_deleted_at    timestamptz;
  v_quarantine_deleted_at    timestamptz;
  v_old_done             boolean;
  v_quar_done            boolean;
  v_new_cleanup_status   text;
  v_ret_status           text;
  v_ret_old_avatar_deleted_at    timestamptz;
  v_ret_quarantine_deleted_at    timestamptz;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'mark_avatar_cleanup_progress: p_job_id must not be NULL';
  END IF;
  IF p_cleanup_worker_id IS NULL OR btrim(p_cleanup_worker_id) = '' THEN
    RAISE EXCEPTION 'mark_avatar_cleanup_progress: p_cleanup_worker_id must not be NULL or empty';
  END IF;

  -- Lock the job row and read current state
  SELECT aj.status, aj.cleanup_status, aj.cleanup_worker_id,
         aj.previous_avatar_path,
         aj.old_avatar_deleted_at, aj.quarantine_deleted_at
    INTO v_status, v_cleanup_status, v_cleanup_worker_id,
         v_previous_avatar_path,
         v_old_avatar_deleted_at, v_quarantine_deleted_at
    FROM public.avatar_jobs aj
   WHERE aj.id = p_job_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_status <> 'completed'
     OR v_cleanup_status <> 'processing'
     OR v_cleanup_worker_id <> p_cleanup_worker_id THEN
    RAISE EXCEPTION 'mark_avatar_cleanup_progress: no completed/processing cleanup job % owned by worker %',
      p_job_id, p_cleanup_worker_id;
  END IF;

  -- Determine completion of each step.
  -- If previous_avatar_path IS NULL, old avatar deletion is considered already done.
  v_old_done := (v_previous_avatar_path IS NULL) OR (v_old_avatar_deleted_at IS NOT NULL) OR (p_old_deleted = true);
  v_quar_done := (v_quarantine_deleted_at IS NOT NULL) OR (p_quarantine_deleted = true);

  IF v_old_done AND v_quar_done THEN
    v_new_cleanup_status := 'completed';
  ELSE
    v_new_cleanup_status := 'processing';
  END IF;

  -- Single UPDATE ... RETURNING so returned values come from the stored row.
  UPDATE public.avatar_jobs AS aj
     SET old_avatar_deleted_at = CASE
           WHEN p_old_deleted AND aj.old_avatar_deleted_at IS NULL AND aj.previous_avatar_path IS NOT NULL
             THEN now()
           ELSE aj.old_avatar_deleted_at
         END,
         quarantine_deleted_at = CASE
           WHEN p_quarantine_deleted AND aj.quarantine_deleted_at IS NULL
             THEN now()
           ELSE aj.quarantine_deleted_at
         END,
         cleanup_status = v_new_cleanup_status,
         cleanup_worker_id = CASE
           WHEN v_old_done AND v_quar_done THEN NULL
           ELSE aj.cleanup_worker_id
         END,
         cleanup_started_at = CASE
           WHEN v_old_done AND v_quar_done THEN NULL
           ELSE aj.cleanup_started_at
         END,
         cleanup_heartbeat_at = CASE
           WHEN v_old_done AND v_quar_done THEN NULL
           ELSE aj.cleanup_heartbeat_at
         END,
         cleanup_next_retry_at = CASE
           WHEN v_old_done AND v_quar_done THEN NULL
           ELSE aj.cleanup_next_retry_at
         END,
         cleanup_last_error = CASE
           WHEN v_old_done AND v_quar_done THEN NULL
           ELSE aj.cleanup_last_error
         END,
         updated_at = now()
   WHERE aj.id = p_job_id
     AND aj.status = 'completed'
     AND aj.cleanup_status = 'processing'
     AND aj.cleanup_worker_id = p_cleanup_worker_id
  RETURNING aj.cleanup_status,
           aj.old_avatar_deleted_at,
           aj.quarantine_deleted_at
    INTO v_ret_status, v_ret_old_avatar_deleted_at, v_ret_quarantine_deleted_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_avatar_cleanup_progress: update affected 0 rows for job %', p_job_id;
  END IF;

  RETURN QUERY
    SELECT v_ret_status, v_ret_old_avatar_deleted_at, v_ret_quarantine_deleted_at;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_avatar_cleanup_progress(uuid, text, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_avatar_cleanup_progress(uuid, text, boolean, boolean)
  TO service_role;
