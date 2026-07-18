/*
# Avatar Processing — Phase 1 RPC (complete)

## Purpose
Add the service-role-only RPC that the avatar processing worker calls when
it has finished processing a job: it atomically finalizes the avatar job,
publishes the new avatar into the user's profile, and schedules the old
avatar file for cleanup.

## public.complete_avatar_job(
  p_job_id      uuid,
  p_worker_id   text,
  p_output_path text,
  p_avatar_url  text
)
RETURNS TABLE (previous_avatar_path text, output_path text)

Behavior:
1. Validate inputs (non-null/non-empty; p_output_path must not contain '..').
2. Lock the avatar_jobs row with FOR UPDATE.
3. Idempotent path: if status='completed', return the stored
   previous_avatar_path + output_path unchanged; raise EXCEPTION if
   p_output_path differs from the stored output_path.
4. Normal path: only when status='processing' AND worker_id=p_worker_id.
5. Capture profiles.avatar_storage_path (old) into previous_avatar_path.
6. In the same transaction:
     - Update exactly one profiles row:
         avatar_url = p_avatar_url
         avatar_storage_path = p_output_path
         updated_at = now()
       Raise EXCEPTION if zero rows updated (profile missing).
     - Update the avatar_jobs row to:
         status='completed', output_path=p_output_path,
         previous_avatar_path=<old profile path>,
         cleanup_status='pending', cleanup_attempt_count=0,
         cleanup_next_retry_at=NULL,
         completed_at=now(), worker_id=NULL, started_at=NULL,
         heartbeat_at=NULL, updated_at=now()
7. Return previous_avatar_path, output_path.

## Security
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

CREATE OR REPLACE FUNCTION public.complete_avatar_job(
  p_job_id      uuid,
  p_worker_id   text,
  p_output_path text,
  p_avatar_url  text
)
RETURNS TABLE (
  previous_avatar_path text,
  output_path           text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status               text;
  v_worker_id            text;
  v_stored_output_path   text;
  v_stored_prev_path     text;
  v_old_avatar_path      text;
  v_profiles_updated     integer;
BEGIN
  -- 1. Validate inputs
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'complete_avatar_job: p_job_id must not be NULL';
  END IF;
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'complete_avatar_job: p_worker_id must not be NULL or empty';
  END IF;
  IF p_output_path IS NULL OR btrim(p_output_path) = '' THEN
    RAISE EXCEPTION 'complete_avatar_job: p_output_path must not be NULL or empty';
  END IF;
  IF p_avatar_url IS NULL OR btrim(p_avatar_url) = '' THEN
    RAISE EXCEPTION 'complete_avatar_job: p_avatar_url must not be NULL or empty';
  END IF;
  IF position('..' in p_output_path) > 0 THEN
    RAISE EXCEPTION 'complete_avatar_job: p_output_path must not contain ".." (path traversal)';
  END IF;

  -- 2. Lock the job row
  SELECT aj.status, aj.worker_id, aj.output_path, aj.previous_avatar_path
    INTO v_status, v_worker_id, v_stored_output_path, v_stored_prev_path
    FROM public.avatar_jobs aj
   WHERE aj.id = p_job_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'complete_avatar_job: job % not found', p_job_id;
  END IF;

  -- 3. Idempotent path
  IF v_status = 'completed' THEN
    IF p_output_path <> v_stored_output_path THEN
      RAISE EXCEPTION 'complete_avatar_job: job % already completed with a different output_path', p_job_id;
    END IF;
    RETURN QUERY SELECT v_stored_prev_path, v_stored_output_path;
    RETURN;
  END IF;

  -- 4. Normal path: must be processing and owned by p_worker_id
  IF v_status <> 'processing' THEN
    RAISE EXCEPTION 'complete_avatar_job: job % is not in processing state (current: %)', p_job_id, v_status;
  END IF;
  IF v_worker_id <> p_worker_id THEN
    RAISE EXCEPTION 'complete_avatar_job: job % is owned by worker %, not %',
      p_job_id, v_worker_id, p_worker_id;
  END IF;

  -- 5. Capture the profile's current avatar_storage_path
  SELECT p.avatar_storage_path
    INTO v_old_avatar_path
    FROM public.profiles p
   WHERE p.user_id = (SELECT aj.user_id FROM public.avatar_jobs aj WHERE aj.id = p_job_id);

  -- 6a. Update exactly one profile row
  UPDATE public.profiles AS p
     SET avatar_url          = p_avatar_url,
         avatar_storage_path = p_output_path,
         updated_at          = now()
   WHERE p.user_id = (SELECT aj.user_id FROM public.avatar_jobs aj WHERE aj.id = p_job_id);

  GET DIAGNOSTICS v_profiles_updated = ROW_COUNT;
  IF v_profiles_updated <> 1 THEN
    RAISE EXCEPTION 'complete_avatar_job: expected to update 1 profile, updated %',
      v_profiles_updated;
  END IF;

  -- 6b. Finalize the avatar job
  UPDATE public.avatar_jobs AS aj
     SET status                = 'completed',
         output_path           = p_output_path,
         previous_avatar_path  = v_old_avatar_path,
         cleanup_status        = 'pending',
         cleanup_attempt_count = 0,
         cleanup_next_retry_at = NULL,
         completed_at          = now(),
         worker_id             = NULL,
         started_at            = NULL,
         heartbeat_at          = NULL,
         updated_at            = now()
   WHERE aj.id = p_job_id;

  -- 7. Return result
  RETURN QUERY SELECT v_old_avatar_path, p_output_path;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_avatar_job(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_avatar_job(uuid, text, text, text)
  TO service_role;
