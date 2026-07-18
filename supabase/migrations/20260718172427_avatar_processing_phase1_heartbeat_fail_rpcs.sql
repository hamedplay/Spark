/*
# Avatar Processing — Phase 1 RPCs (heartbeat + fail)

## Purpose
Add the two service-role-only RPCs that the avatar processing worker uses to
refresh a job's heartbeat while processing, and to mark a job as failed
(either transiently with a backoff retry, or permanently).

## 1. public.heartbeat_avatar_job(p_job_id uuid, p_worker_id text)
Updates heartbeat_at and updated_at to now() for the job identified by
p_job_id ONLY when:
  - status = 'processing'
  - worker_id = p_worker_id
Raises an EXCEPTION with a clear message if no row is updated (either the
job does not exist, is not in 'processing', or belongs to a different
worker).

## 2. public.fail_avatar_job(p_job_id uuid, p_worker_id text, p_error text, p_permanent boolean DEFAULT false)
Marks a 'processing' job owned by p_worker_id as failed or retry-wait.

Behavior:
  - If p_permanent = true:
      status = 'failed', completed_at = now(), next_retry_at = NULL
  - Else if attempt_count < max_attempts (transient, retries remain):
      status = 'retry_wait'
      next_retry_at = now() + make_interval(secs => 60 * attempt_count)
        (attempt 1 -> +60s, attempt 2 -> +120s)
  - Else (attempt_count >= max_attempts, retries exhausted):
      status = 'failed', completed_at = now()
  In all cases:
      last_error = p_error
      worker_id = NULL
      started_at = NULL
      heartbeat_at = NULL
      updated_at = now()

ROW_COUNT is checked; if zero rows updated, an EXCEPTION is raised (job not
found, not processing, or worker mismatch).

## Security
Both functions:
  - SECURITY DEFINER
  - SET search_path = ''
  - all identifiers schema-qualified
  - REVOKE ALL from PUBLIC, anon, authenticated
  - GRANT EXECUTE only to service_role

## Notes
- No buckets, storage policies, edge functions, workers, or frontend changes.
- No other RPCs created.
- Idempotent (CREATE OR REPLACE, guarded REVOKE/GRANT).
*/

-- ============================================================================
-- 1. heartbeat_avatar_job
-- ============================================================================
CREATE OR REPLACE FUNCTION public.heartbeat_avatar_job(
  p_job_id    uuid,
  p_worker_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'heartbeat_avatar_job: p_job_id must not be NULL';
  END IF;
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'heartbeat_avatar_job: p_worker_id must not be NULL or empty';
  END IF;

  UPDATE public.avatar_jobs AS aj
     SET heartbeat_at = now(),
         updated_at    = now()
   WHERE aj.id        = p_job_id
     AND aj.status    = 'processing'
     AND aj.worker_id = p_worker_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'heartbeat_avatar_job: no processing job % owned by worker %',
      p_job_id, p_worker_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.heartbeat_avatar_job(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_avatar_job(uuid, text)
  TO service_role;

-- ============================================================================
-- 2. fail_avatar_job
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fail_avatar_job(
  p_job_id     uuid,
  p_worker_id  text,
  p_error      text,
  p_permanent  boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt_count integer;
  v_max_attempts  integer;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'fail_avatar_job: p_job_id must not be NULL';
  END IF;
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'fail_avatar_job: p_worker_id must not be NULL or empty';
  END IF;

  -- Fetch current counters under the ownership + status guard.
  SELECT aj.attempt_count, aj.max_attempts
    INTO v_attempt_count, v_max_attempts
    FROM public.avatar_jobs aj
   WHERE aj.id        = p_job_id
     AND aj.status    = 'processing'
     AND aj.worker_id = p_worker_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fail_avatar_job: no processing job % owned by worker %',
      p_job_id, p_worker_id;
  END IF;

  IF p_permanent THEN
    UPDATE public.avatar_jobs AS aj
       SET status        = 'failed',
           completed_at  = now(),
           next_retry_at = NULL,
           last_error    = p_error,
           worker_id     = NULL,
           started_at    = NULL,
           heartbeat_at  = NULL,
           updated_at    = now()
     WHERE aj.id = p_job_id;
  ELSIF v_attempt_count < v_max_attempts THEN
    UPDATE public.avatar_jobs AS aj
       SET status        = 'retry_wait',
           next_retry_at = now() + make_interval(secs => 60 * v_attempt_count),
           completed_at  = NULL,
           last_error    = p_error,
           worker_id     = NULL,
           started_at    = NULL,
           heartbeat_at  = NULL,
           updated_at    = now()
     WHERE aj.id = p_job_id;
  ELSE
    UPDATE public.avatar_jobs AS aj
       SET status        = 'failed',
           completed_at  = now(),
           next_retry_at = NULL,
           last_error    = p_error,
           worker_id     = NULL,
           started_at    = NULL,
           heartbeat_at  = NULL,
           updated_at    = now()
     WHERE aj.id = p_job_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fail_avatar_job: update affected 0 rows for job %', p_job_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_avatar_job(uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_avatar_job(uuid, text, text, boolean)
  TO service_role;
