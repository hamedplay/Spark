-- Preserve the configured idle/absolute security policy. Keep only 30 days of
-- historical presentation data. Never delete or modify Supabase Auth sessions.
CREATE OR REPLACE FUNCTION private.cleanup_session_security_history()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_deleted integer;
BEGIN
  WITH stale AS (
    SELECT s.id FROM public.session_security_state s
    WHERE NOT EXISTS (SELECT 1 FROM auth.sessions a WHERE a.id = s.session_id)
      AND greatest(s.created_at, s.last_activity_at,
            COALESCE(s.revoked_at, least(s.idle_expiry_at, s.absolute_expiry_at)))
          < now() - interval '30 days'
    ORDER BY s.last_activity_at, s.id
    LIMIT 5000
    FOR UPDATE OF s SKIP LOCKED
  )
  DELETE FROM public.session_security_state s USING stale
  WHERE s.id = stale.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
REVOKE ALL ON FUNCTION private.cleanup_session_security_history() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.cleanup_session_security_history() TO postgres;

CREATE OR REPLACE FUNCTION private.get_user_session_security_state_impl(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_caller_uid uuid := auth.uid();
BEGIN
  IF v_caller_uid IS NOT NULL AND v_caller_uid <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_ID_REQUIRED');
  END IF;

  RETURN jsonb_build_object('ok', true, 'sessions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'session_id', s.session_id,
      'created_at', s.created_at,
      'last_activity_at', s.last_activity_at,
      'idle_expiry_at', s.idle_expiry_at,
      'absolute_expiry_at', s.absolute_expiry_at,
      'revoked_at', s.revoked_at,
      'revoke_reason', s.revoke_reason,
      'device_summary', s.device_summary,
      'status', CASE
        WHEN s.revoked_at IS NOT NULL THEN 'revoked'
        WHEN a.id IS NULL THEN 'expired'
        WHEN s.auth_epoch <> COALESCE(p.auth_epoch, 1) THEN 'epoch_expired'
        WHEN s.absolute_expiry_at <= now() THEN 'absolute_expired'
        WHEN s.idle_expiry_at <= now() THEN 'idle_expired'
        ELSE 'active'
      END
    ) ORDER BY s.created_at DESC)
    FROM public.session_security_state s
    LEFT JOIN auth.sessions a
      ON a.id = s.session_id
      AND a.user_id = s.user_id
      AND (a.not_after IS NULL OR a.not_after > now())
    LEFT JOIN public.profiles p ON p.user_id = s.user_id
    WHERE s.user_id = p_user_id
      AND (
        (s.revoked_at IS NULL AND a.id IS NOT NULL
         AND s.auth_epoch = COALESCE(p.auth_epoch, 1)
         AND s.idle_expiry_at > now() AND s.absolute_expiry_at > now())
        OR greatest(s.created_at, s.last_activity_at,
             COALESCE(s.revoked_at, least(s.idle_expiry_at, s.absolute_expiry_at)))
           >= now() - interval '30 days'
      )
  ), '[]'::jsonb));
END;
$function$;

SELECT cron.schedule('spark-session-history-retention', '0 * * * *',
  'SELECT private.cleanup_session_security_history();');
