-- Access-control and behavior regressions; no fixtures or callback events commit.
BEGIN;
SET LOCAL statement_timeout='20s';
DO $test$
DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.bulk_classify_phone_sync(boolean)',
    'public.diagnose_phone_auth_sync_status(uuid)',
    'public.diagnose_phone_only_orphans()',
    'public.get_auth_health_check()',
    'public.get_auth_identity_integrity_v1()',
    'public.get_admin_user_delete_blockers(uuid)',
    'public.get_custom_mfa_readiness()',
    'public.check_phone_login_dependencies_ready()',
    'public.check_phone_login_readiness()',
    'public.apply_livekit_webhook_event_v1(text,text,text,text,text,jsonb)',
    'public.apply_livekit_recording_reconcile_v1(text,text,integer,jsonb)',
    'public.ensure_default_calendars_for_user(uuid)'
  ] LOOP
    ASSERT to_regprocedure(signature) IS NOT NULL,'Required RPC missing: '||signature;
    ASSERT NOT has_function_privilege('anon',signature,'EXECUTE'),'Anonymous diagnostic/callback exposed: '||signature;
    ASSERT NOT has_function_privilege('authenticated',signature,'EXECUTE'),'Browser diagnostic/callback exposed: '||signature;
    ASSERT has_function_privilege('service_role',signature,'EXECUTE'),'Server RPC denied: '||signature;
  END LOOP;
  ASSERT has_function_privilege('anon','public.get_public_auth_config()','EXECUTE');
  ASSERT has_function_privilege('anon','public.get_public_login_methods()','EXECUTE');
  ASSERT has_function_privilege('authenticated','public.get_custom_mfa_state()','EXECUTE');
  ASSERT has_function_privilege('authenticated','public.get_mfa_policy_state()','EXECUTE');
END $test$;

SET LOCAL ROLE anon;
DO $test$ BEGIN
  BEGIN PERFORM public.bulk_classify_phone_sync(true); RAISE EXCEPTION 'Anonymous user enumeration accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_auth_health_check(); RAISE EXCEPTION 'Anonymous security settings read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.apply_livekit_webhook_event_v1('room_finished','test',NULL,NULL,NULL,'{}');
    RAISE EXCEPTION 'Anonymous provider event accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.apply_livekit_recording_reconcile_v1('test','test',3,'{}');
    RAISE EXCEPTION 'Anonymous recording callback accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.ensure_default_calendars_for_user(gen_random_uuid());
    RAISE EXCEPTION 'Anonymous calendar creation accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.get_public_auth_config();
  PERFORM public.get_public_login_methods();
END $test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $test$ BEGIN
  BEGIN PERFORM public.bulk_classify_phone_sync(true); RAISE EXCEPTION 'Browser user enumeration accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.apply_livekit_webhook_event_v1('room_finished','test',NULL,NULL,NULL,'{}');
    RAISE EXCEPTION 'Browser provider event accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.ensure_default_calendars_for_user(gen_random_uuid());
    RAISE EXCEPTION 'Browser calendar creation accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.get_custom_mfa_state();
  PERFORM public.get_mfa_policy_state();
END $test$;
RESET ROLE;

CREATE TEMP TABLE calendar_security_users AS
SELECT n,gen_random_uuid() user_id FROM generate_series(0,2)n;
INSERT INTO auth.users(id,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
SELECT user_id,now(),now(),'{}','{}' FROM calendar_security_users;
INSERT INTO public.profiles(user_id,full_name,account_status,is_active,profile_completion_status,registration_source)
SELECT user_id,'Calendar security fixture '||n,CASE WHEN n=2 THEN 'SUSPENDED' ELSE 'ACTIVE' END,n<>2,'COMPLETE','imported'
FROM calendar_security_users;
-- Only fixture users are affected by this rolled-back cleanup.
DELETE FROM public.calendars WHERE user_id IN(SELECT user_id FROM calendar_security_users);
GRANT SELECT ON calendar_security_users TO service_role,authenticated;

SET LOCAL ROLE service_role;
DO $test$
DECLARE u uuid:=(SELECT user_id FROM calendar_security_users WHERE n=0);
  event text:='rpc-security-test-'||gen_random_uuid()::text;
BEGIN
  PERFORM public.ensure_default_calendars_for_user(u);
  PERFORM public.ensure_default_calendars_for_user(u);
  ASSERT (SELECT count(*) FROM public.calendars WHERE user_id=u)=2,'Repeated ensure duplicated defaults';
  ASSERT public.get_auth_health_check() ? 'settings','Server health-check path broke';
  ASSERT public.get_auth_identity_integrity_v1() ? 'ok','Server identity check broke';
  PERFORM public.bulk_classify_phone_sync(true);
  PERFORM public.diagnose_phone_only_orphans();
  PERFORM public.diagnose_phone_auth_sync_status(u);
  PERFORM public.get_custom_mfa_readiness();
  PERFORM public.check_phone_login_readiness();
  PERFORM public.get_admin_user_delete_blockers(u);
  ASSERT (public.apply_livekit_recording_reconcile_v1(event,'test',3,'{}')->>'ignored')::boolean,'Server reconcile path broke';
  PERFORM public.apply_livekit_webhook_event_v1('rpc_security_test',event,event,NULL,NULL,'{}');
  ASSERT EXISTS(SELECT FROM public.livekit_webhook_events WHERE event_id=event),'Server callback failed to record its event';
  PERFORM public.ensure_default_calendars_for_user((SELECT user_id FROM calendar_security_users WHERE n=2));
  ASSERT NOT EXISTS(SELECT FROM public.calendars WHERE user_id=(SELECT user_id FROM calendar_security_users WHERE n=2)),'Inactive profile got calendars';
END $test$;
RESET ROLE;

UPDATE public.profiles SET full_name='Renamed fixture' WHERE user_id=(SELECT user_id FROM calendar_security_users WHERE n=0);
UPDATE public.calendars SET name='Renamed public calendar',is_active=false WHERE user_id=(SELECT user_id FROM calendar_security_users WHERE n=0) AND is_personal_public;
INSERT INTO public.calendars(user_id,name,type,color) SELECT user_id,'Custom private calendar','private','#abcdef' FROM calendar_security_users WHERE n=0;
SET LOCAL ROLE service_role;
DO $test$
DECLARE u uuid:=(SELECT user_id FROM calendar_security_users WHERE n=0);
BEGIN
  PERFORM public.ensure_default_calendars_for_user(u);
  ASSERT (SELECT count(*) FROM public.calendars WHERE user_id=u)=3,'Renaming created extra defaults or removed a custom calendar';
  ASSERT EXISTS(SELECT FROM public.calendars WHERE user_id=u AND is_personal_public AND name='Renamed public calendar' AND is_active=false),'Ensure overwrote user calendar preferences';
END $test$;
RESET ROLE;

-- Exercise the owner-executed lifecycle helper chain under a browser role.
CREATE TEMP TABLE calendar_security_namespace_init(id integer);
CREATE FUNCTION pg_temp.calendar_security_owner_ensure(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT public.ensure_default_calendars_for_user(p_user_id) $$;
DO $test$ BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated',(SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema()));
END $test$;
GRANT EXECUTE ON FUNCTION pg_temp.calendar_security_owner_ensure(uuid) TO authenticated;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
  PERFORM pg_temp.calendar_security_owner_ensure((SELECT user_id FROM calendar_security_users WHERE n=1));
  PERFORM pg_temp.calendar_security_owner_ensure((SELECT user_id FROM calendar_security_users WHERE n=1));
END $test$;
RESET ROLE;
DO $test$ BEGIN
  ASSERT (SELECT count(*) FROM public.calendars WHERE user_id=(SELECT user_id FROM calendar_security_users WHERE n=1))=2,'Lifecycle owner chain failed';
END $test$;
SELECT 'diagnostic/callback ACLs, server paths and idempotent calendar creation passed' AS result;
ROLLBACK;
