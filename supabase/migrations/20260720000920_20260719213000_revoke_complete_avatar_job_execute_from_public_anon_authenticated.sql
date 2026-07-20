-- complete_avatar_job is SECURITY DEFINER and updates profiles.avatar_url /
-- avatar_storage_path. Although the body validates job state and worker_id,
-- EXECUTE was inherited by anon and authenticated via PUBLIC. Restrict
-- execution to the service_role used by the avatar worker only. Body,
-- signature, owner, and search_path are unchanged.

REVOKE EXECUTE ON FUNCTION public.complete_avatar_job(p_job_id uuid, p_worker_id text, p_output_path text, p_avatar_url text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_avatar_job(p_job_id uuid, p_worker_id text, p_output_path text, p_avatar_url text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_avatar_job(p_job_id uuid, p_worker_id text, p_output_path text, p_avatar_url text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_avatar_job(p_job_id uuid, p_worker_id text, p_output_path text, p_avatar_url text) TO service_role;
