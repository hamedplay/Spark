/*
# Avatar Processing — Phase 1 RPCs (create + claim)

## Purpose
Add the two service-role-only RPCs that the avatar processing worker uses to
enqueue a new avatar job and to atomically claim the next eligible job.

## 1. public.create_avatar_job(p_user_id uuid, p_quarantine_path text)
Creates a new row in `public.avatar_jobs` with:
  - status = 'pending'
  - cleanup_status = NULL (cleanup not yet scheduled)
  - attempt_count = 0
  - max_attempts = 3
  - created_at / updated_at = now()

Validation (raises EXCEPTION on failure):
  - p_user_id IS NOT NULL
  - p_quarantine_path IS NOT NULL and length(trim(...)) > 0
  - a matching profile exists in public.profiles (user_id)
  - quarantine_path must NOT contain '..' (path traversal)
  - quarantine_path should start with '{user_id}/' (soft check via EXCEPTION)

Returns: id, user_id, quarantine_path, status, created_at.

## 2. public.claim_next_avatar_job(p_worker_id text)
Atomically claims one eligible job using FOR UPDATE SKIP LOCKED.

Eligible statuses:
  - 'pending' (always eligible)
  - 'retry_wait' only when next_retry_at IS NULL OR next_retry_at <= now()

Selection order: oldest created_at first.
Excludes jobs where attempt_count >= max_attempts (exhausted).

On claim, sets immediately:
  - status = 'processing'
  - worker_id = p_worker_id
  - started_at = now()
  - heartbeat_at = now()
  - attempt_count = attempt_count + 1
  - next_retry_at = NULL
  - updated_at = now()

Returns: id, user_id, quarantine_path, attempt_count, max_attempts
(or no rows if nothing eligible).

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
-- 1. create_avatar_job
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_avatar_job(
  p_user_id         uuid,
  p_quarantine_path  text
)
RETURNS TABLE (
  id               uuid,
  user_id          uuid,
  quarantine_path  text,
  status           text,
  created_at       timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_exists boolean;
  v_path           text;
  v_new_id         uuid;
  v_created_at     timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'create_avatar_job: p_user_id must not be NULL';
  END IF;

  IF p_quarantine_path IS NULL OR btrim(p_quarantine_path) = '' THEN
    RAISE EXCEPTION 'create_avatar_job: p_quarantine_path must not be NULL or empty';
  END IF;

  v_path := p_quarantine_path;

  IF position('..' in v_path) > 0 THEN
    RAISE EXCEPTION 'create_avatar_job: quarantine_path must not contain ".." (path traversal)';
  END IF;

  IF NOT (v_path LIKE p_user_id::text || '/%') THEN
    RAISE EXCEPTION 'create_avatar_job: quarantine_path must start with "%/"', p_user_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = p_user_id
  ) INTO v_profile_exists;

  IF NOT v_profile_exists THEN
    RAISE EXCEPTION 'create_avatar_job: no profile found for user_id %', p_user_id;
  END IF;

  INSERT INTO public.avatar_jobs (
      user_id, quarantine_path, status,
      attempt_count, max_attempts,
      created_at, updated_at
  )
  VALUES (
      p_user_id, v_path, 'pending',
      0, 3,
      now(), now()
  )
  RETURNING public.avatar_jobs.id, public.avatar_jobs.created_at
    INTO v_new_id, v_created_at;

  RETURN QUERY
    SELECT v_new_id, p_user_id, v_path, 'pending'::text, v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_avatar_job(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_avatar_job(uuid, text)
  TO service_role;

-- ============================================================================
-- 2. claim_next_avatar_job
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_next_avatar_job(
  p_worker_id text
)
RETURNS TABLE (
  id               uuid,
  user_id          uuid,
  quarantine_path  text,
  attempt_count    integer,
  max_attempts     integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job_id          uuid;
  v_user_id         uuid;
  v_quarantine_path text;
  v_attempt_count   integer;
  v_max_attempts    integer;
BEGIN
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'claim_next_avatar_job: p_worker_id must not be NULL or empty';
  END IF;

  -- Atomic claim: oldest eligible job, skip locked rows.
  -- Eligible: pending (always) OR retry_wait with next_retry_at NULL or <= now().
  -- Exclude exhausted jobs (attempt_count >= max_attempts).
  WITH picked AS (
    SELECT aj.id
    FROM public.avatar_jobs aj
    WHERE aj.status IN ('pending','retry_wait')
      AND (aj.status = 'pending'
           OR aj.next_retry_at IS NULL
           OR aj.next_retry_at <= now())
      AND aj.attempt_count < aj.max_attempts
    ORDER BY aj.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.avatar_jobs AS aj
     SET status           = 'processing',
         worker_id        = p_worker_id,
         started_at       = now(),
         heartbeat_at     = now(),
         attempt_count    = aj.attempt_count + 1,
         next_retry_at    = NULL,
         updated_at       = now()
    FROM picked
    WHERE aj.id = picked.id
  RETURNING aj.id, aj.user_id, aj.quarantine_path,
            aj.attempt_count, aj.max_attempts
    INTO v_job_id, v_user_id, v_quarantine_path,
         v_attempt_count, v_max_attempts;

  IF v_job_id IS NOT NULL THEN
    RETURN QUERY
      SELECT v_job_id, v_user_id, v_quarantine_path,
             v_attempt_count, v_max_attempts;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_avatar_job(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_avatar_job(text)
  TO service_role;
