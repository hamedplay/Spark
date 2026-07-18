/*
# Avatar Processing — Fix reclaim_avatar_jobs WHERE precedence

The previous migration had an AND/OR precedence bug in the WHERE clause
of reclaim_avatar_jobs. This corrects it so that:
  - status='processing' (always required)
  - at least one of heartbeat_at / started_at is NOT NULL
  - COALESCE(heartbeat_at, started_at) < now() - 180s
*/
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
      AND (aj.heartbeat_at IS NOT NULL OR aj.started_at IS NOT NULL)
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
