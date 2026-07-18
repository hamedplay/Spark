/*
# Avatar Processing — Cleanup RPCs (claim + heartbeat)

## Purpose
Add two service-role-only RPCs that the cleanup worker uses to atomically
claim a completed avatar job whose old avatar/quarantine files need to be
deleted, and to refresh the cleanup heartbeat while that deletion work is
in progress.

## 1. public.claim_avatar_cleanup_job(p_cleanup_worker_id text)
Atomically claims ONE eligible completed job using FOR UPDATE SKIP LOCKED.

Eligible:
  - status = 'completed'
  - cleanup_status = 'pending'
  - cleanup_next_retry_at IS NULL OR cleanup_next_retry_at <= now()
  - cleanup_attempt_count < 3

Selection order: oldest updated_at first.

On claim, sets immediately:
  - cleanup_status        = 'processing'
  - cleanup_worker_id      = p_cleanup_worker_id
  - cleanup_started_at    = now()
  - cleanup_heartbeat_at  = now()
  - cleanup_attempt_count = cleanup_attempt_count + 1
  - cleanup_next_retry_at = NULL
  - updated_at            = now()

Returns (or no rows if nothing eligible — no exception):
  id, user_id, previous_avatar_path, quarantine_path, output_path,
  cleanup_attempt_count, old_avatar_deleted_at, quarantine_deleted_at

## 2. public.heartbeat_avatar_cleanup_job(p_job_id uuid, p_cleanup_worker_id text)
Updates cleanup_heartbeat_at and updated_at to now() for the job identified
by p_job_id ONLY when:
  - status = 'completed'
  - cleanup_status = 'processing'
  - cleanup_worker_id = p_cleanup_worker_id
Raises an EXCEPTION with a clear message if no row is updated.

## Security (both functions)
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
-- 1. claim_avatar_cleanup_job
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_avatar_cleanup_job(
  p_cleanup_worker_id text
)
RETURNS TABLE (
  id                       uuid,
  user_id                  uuid,
  previous_avatar_path     text,
  quarantine_path          text,
  output_path              text,
  cleanup_attempt_count    integer,
  old_avatar_deleted_at    timestamptz,
  quarantine_deleted_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job_id               uuid;
  v_user_id              uuid;
  v_previous_avatar_path text;
  v_quarantine_path      text;
  v_output_path          text;
  v_cleanup_attempt_count integer;
  v_old_avatar_deleted_at timestamptz;
  v_quarantine_deleted_at timestamptz;
BEGIN
  IF p_cleanup_worker_id IS NULL OR btrim(p_cleanup_worker_id) = '' THEN
    RAISE EXCEPTION 'claim_avatar_cleanup_job: p_cleanup_worker_id must not be NULL or empty';
  END IF;

  WITH picked AS (
    SELECT aj.id
    FROM public.avatar_jobs aj
    WHERE aj.status = 'completed'
      AND aj.cleanup_status = 'pending'
      AND (aj.cleanup_next_retry_at IS NULL OR aj.cleanup_next_retry_at <= now())
      AND aj.cleanup_attempt_count < 3
    ORDER BY aj.updated_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.avatar_jobs AS aj
     SET cleanup_status         = 'processing',
         cleanup_worker_id      = p_cleanup_worker_id,
         cleanup_started_at    = now(),
         cleanup_heartbeat_at  = now(),
         cleanup_attempt_count = aj.cleanup_attempt_count + 1,
         cleanup_next_retry_at = NULL,
         updated_at            = now()
    FROM picked
    WHERE aj.id = picked.id
  RETURNING aj.id, aj.user_id, aj.previous_avatar_path, aj.quarantine_path,
            aj.output_path, aj.cleanup_attempt_count,
            aj.old_avatar_deleted_at, aj.quarantine_deleted_at
    INTO v_job_id, v_user_id, v_previous_avatar_path, v_quarantine_path,
         v_output_path, v_cleanup_attempt_count,
         v_old_avatar_deleted_at, v_quarantine_deleted_at;

  IF v_job_id IS NOT NULL THEN
    RETURN QUERY
      SELECT v_job_id, v_user_id, v_previous_avatar_path, v_quarantine_path,
             v_output_path, v_cleanup_attempt_count,
             v_old_avatar_deleted_at, v_quarantine_deleted_at;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_avatar_cleanup_job(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_avatar_cleanup_job(text)
  TO service_role;

-- ============================================================================
-- 2. heartbeat_avatar_cleanup_job
-- ============================================================================
CREATE OR REPLACE FUNCTION public.heartbeat_avatar_cleanup_job(
  p_job_id            uuid,
  p_cleanup_worker_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'heartbeat_avatar_cleanup_job: p_job_id must not be NULL';
  END IF;
  IF p_cleanup_worker_id IS NULL OR btrim(p_cleanup_worker_id) = '' THEN
    RAISE EXCEPTION 'heartbeat_avatar_cleanup_job: p_cleanup_worker_id must not be NULL or empty';
  END IF;

  UPDATE public.avatar_jobs AS aj
     SET cleanup_heartbeat_at = now(),
         updated_at           = now()
   WHERE aj.id                = p_job_id
     AND aj.status            = 'completed'
     AND aj.cleanup_status    = 'processing'
     AND aj.cleanup_worker_id = p_cleanup_worker_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'heartbeat_avatar_cleanup_job: no completed/processing cleanup job % owned by worker %',
      p_job_id, p_cleanup_worker_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.heartbeat_avatar_cleanup_job(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_avatar_cleanup_job(uuid, text)
  TO service_role;
