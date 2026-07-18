/*
# Avatar Processing — Cleanup RPCs (mark progress + fail)

## 1. public.mark_avatar_cleanup_job(
     p_job_id uuid, p_cleanup_worker_id text,
     p_old_deleted boolean, p_quarantine_deleted boolean
   )
   RETURNS TABLE (cleanup_status text, old_avatar_deleted_at timestamptz,
                  quarantine_deleted_at timestamptz)

Behavior:
- Lock the job row with FOR UPDATE.
- Only update when status='completed', cleanup_status='processing',
  cleanup_worker_id=p_cleanup_worker_id.
- If previous_avatar_path IS NULL, old avatar deletion is considered
  already done (no-op for that step).
- If p_old_deleted=true: old_avatar_deleted_at=COALESCE(old_avatar_deleted_at, now())
- If p_quarantine_deleted=true: quarantine_deleted_at=COALESCE(quarantine_deleted_at, now())
- If both steps done: cleanup_status='completed', clear worker/started/heartbeat/
  next_retry/last_error.
- If steps remain: cleanup_status stays 'processing'.
- Idempotent: re-running with true on a step that already has a timestamp
  does not change the timestamp.
- If no valid row found, raise EXCEPTION.

## 2. public.fail_avatar_cleanup_job(
     p_job_id uuid, p_cleanup_worker_id text,
     p_error text, p_permanent boolean DEFAULT false
   )
   RETURNS void

Behavior:
- Only update when status='completed', cleanup_status='processing',
  cleanup_worker_id=p_cleanup_worker_id.
- p_error must not be NULL or empty.
- If p_permanent=true: cleanup_status='failed', cleanup_next_retry_at=NULL.
- If p_permanent=false AND cleanup_attempt_count < 3:
    cleanup_status='pending',
    cleanup_next_retry_at=now()+make_interval(secs=>60*cleanup_attempt_count)
- If cleanup_attempt_count >= 3: cleanup_status='failed', cleanup_next_retry_at=NULL.
- In all cases:
    cleanup_last_error=p_error, cleanup_worker_id=NULL,
    cleanup_started_at=NULL, cleanup_heartbeat_at=NULL, updated_at=now().
- old_avatar_deleted_at and quarantine_deleted_at are NOT changed.
- Check ROW_COUNT; if zero, raise EXCEPTION.

## Security (both)
- SECURITY DEFINER, SET search_path='', schema-qualified names
- REVOKE ALL from PUBLIC, anon, authenticated
- GRANT EXECUTE only to service_role
*/

-- ============================================================================
-- 1. mark_avatar_cleanup_progress
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
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'mark_avatar_cleanup_progress: p_job_id must not be NULL';
  END IF;
  IF p_cleanup_worker_id IS NULL OR btrim(p_cleanup_worker_id) = '' THEN
    RAISE EXCEPTION 'mark_avatar_cleanup_progress: p_cleanup_worker_id must not be NULL or empty';
  END IF;

  -- Lock the job row
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
         cleanup_status = CASE
           WHEN v_old_done AND v_quar_done THEN 'completed'
           ELSE 'processing'
         END,
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
     AND aj.cleanup_worker_id = p_cleanup_worker_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_avatar_cleanup_progress: update affected 0 rows for job %', p_job_id;
  END IF;

  RETURN QUERY
    SELECT v_new_cleanup_status,
           CASE
             WHEN p_old_deleted AND v_old_avatar_deleted_at IS NULL AND v_previous_avatar_path IS NOT NULL
               THEN now()
             ELSE v_old_avatar_deleted_at
           END,
           CASE
             WHEN p_quarantine_deleted AND v_quarantine_deleted_at IS NULL
               THEN now()
             ELSE v_quarantine_deleted_at
           END;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_avatar_cleanup_progress(uuid, text, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_avatar_cleanup_progress(uuid, text, boolean, boolean)
  TO service_role;

-- ============================================================================
-- 2. fail_avatar_cleanup_job
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fail_avatar_cleanup_job(
  p_job_id             uuid,
  p_cleanup_worker_id  text,
  p_error              text,
  p_permanent          boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cleanup_attempt_count integer;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'fail_avatar_cleanup_job: p_job_id must not be NULL';
  END IF;
  IF p_cleanup_worker_id IS NULL OR btrim(p_cleanup_worker_id) = '' THEN
    RAISE EXCEPTION 'fail_avatar_cleanup_job: p_cleanup_worker_id must not be NULL or empty';
  END IF;
  IF p_error IS NULL OR btrim(p_error) = '' THEN
    RAISE EXCEPTION 'fail_avatar_cleanup_job: p_error must not be NULL or empty';
  END IF;

  SELECT aj.cleanup_attempt_count
    INTO v_cleanup_attempt_count
    FROM public.avatar_jobs aj
   WHERE aj.id = p_job_id
     AND aj.status = 'completed'
     AND aj.cleanup_status = 'processing'
     AND aj.cleanup_worker_id = p_cleanup_worker_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fail_avatar_cleanup_job: no completed/processing cleanup job % owned by worker %',
      p_job_id, p_cleanup_worker_id;
  END IF;

  IF p_permanent THEN
    UPDATE public.avatar_jobs AS aj
       SET cleanup_status         = 'failed',
           cleanup_next_retry_at  = NULL,
           cleanup_last_error    = p_error,
           cleanup_worker_id      = NULL,
           cleanup_started_at    = NULL,
           cleanup_heartbeat_at  = NULL,
           updated_at            = now()
     WHERE aj.id = p_job_id;
  ELSIF v_cleanup_attempt_count < 3 THEN
    UPDATE public.avatar_jobs AS aj
       SET cleanup_status         = 'pending',
           cleanup_next_retry_at = now() + make_interval(secs => 60 * v_cleanup_attempt_count),
           cleanup_last_error    = p_error,
           cleanup_worker_id      = NULL,
           cleanup_started_at    = NULL,
           cleanup_heartbeat_at  = NULL,
           updated_at            = now()
     WHERE aj.id = p_job_id;
  ELSE
    UPDATE public.avatar_jobs AS aj
       SET cleanup_status         = 'failed',
           cleanup_next_retry_at  = NULL,
           cleanup_last_error    = p_error,
           cleanup_worker_id      = NULL,
           cleanup_started_at    = NULL,
           cleanup_heartbeat_at  = NULL,
           updated_at            = now()
     WHERE aj.id = p_job_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fail_avatar_cleanup_job: update affected 0 rows for job %', p_job_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_avatar_cleanup_job(uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_avatar_cleanup_job(uuid, text, text, boolean)
  TO service_role;
