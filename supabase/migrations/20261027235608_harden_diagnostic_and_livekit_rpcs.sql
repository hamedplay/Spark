-- Server-only diagnostics and provider callbacks. Public login/MFA state RPCs
-- retain their grants. Existing SECURITY DEFINER lifecycle callers still work.
DO $migration$
DECLARE v_function record;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND p.proname=ANY(ARRAY[
      'bulk_classify_phone_sync',
      'diagnose_phone_auth_sync_status',
      'diagnose_phone_only_orphans',
      'get_auth_health_check',
      'get_auth_identity_integrity_v1',
      'get_admin_user_delete_blockers',
      'get_custom_mfa_readiness',
      'check_phone_login_dependencies_ready',
      'check_phone_login_readiness',
      'apply_livekit_webhook_event_v1',
      'apply_livekit_recording_reconcile_v1',
      'ensure_default_calendars_for_user'
    ]::text[])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon,authenticated',v_function.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',v_function.signature);
  END LOOP;
END $migration$;
NOTIFY pgrst,'reload schema';
