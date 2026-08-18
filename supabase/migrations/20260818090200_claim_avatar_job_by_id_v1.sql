-- Claim one specific avatar job for synchronous server-side processing.
-- This is intentionally service-role only; browser roles must never execute it.

create or replace function public.claim_avatar_job_by_id_v1(
  p_job_id uuid,
  p_worker_id text
)
returns table(
  id uuid,
  user_id uuid,
  quarantine_path text,
  attempt_count integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_job_id is null then
    raise exception 'claim_avatar_job_by_id_v1: p_job_id must not be NULL';
  end if;

  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'claim_avatar_job_by_id_v1: p_worker_id must not be NULL or empty';
  end if;

  return query
  update public.avatar_jobs as aj
     set status = 'processing',
         worker_id = p_worker_id,
         started_at = now(),
         heartbeat_at = now(),
         attempt_count = aj.attempt_count + 1,
         next_retry_at = null,
         last_error = null,
         updated_at = now()
   where aj.id = p_job_id
     and aj.status in ('pending', 'retry_wait')
     and (aj.status = 'pending' or aj.next_retry_at is null or aj.next_retry_at <= now())
     and aj.attempt_count < aj.max_attempts
  returning aj.id, aj.user_id, aj.quarantine_path, aj.attempt_count, aj.max_attempts;
end;
$$;

revoke all on function public.claim_avatar_job_by_id_v1(uuid, text) from public;
revoke all on function public.claim_avatar_job_by_id_v1(uuid, text) from anon;
revoke all on function public.claim_avatar_job_by_id_v1(uuid, text) from authenticated;
grant execute on function public.claim_avatar_job_by_id_v1(uuid, text) to service_role;
