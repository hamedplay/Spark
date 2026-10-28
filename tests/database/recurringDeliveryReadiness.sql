BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE stale_series_fixture AS SELECT gen_random_uuid() user_id,gen_random_uuid() recipient_id,gen_random_uuid() series_id,gen_random_uuid() session_id;
INSERT INTO auth.users(id,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
SELECT user_id,now(),now(),'{}'::jsonb,'{}'::jsonb FROM stale_series_fixture UNION ALL SELECT recipient_id,now(),now(),'{}'::jsonb,'{}'::jsonb FROM stale_series_fixture;
INSERT INTO public.profiles(user_id,full_name,account_status,is_active,profile_completion_status,registration_source)
SELECT user_id,'Recurring stale fixture owner','ACTIVE',true,'COMPLETE','imported' FROM stale_series_fixture
UNION ALL SELECT recipient_id,'Recurring stale fixture recipient','ACTIVE',true,'COMPLETE','imported' FROM stale_series_fixture;
UPDATE public.profiles SET is_admin=true WHERE user_id=(SELECT user_id FROM stale_series_fixture);
INSERT INTO auth.sessions(id,user_id,created_at,updated_at,aal)
SELECT session_id,user_id,now(),now(),'aal1' FROM stale_series_fixture;
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT f.session_id,f.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours' FROM stale_series_fixture f JOIN public.profiles p USING(user_id);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true) FROM stale_series_fixture;
SELECT public.create_meeting_series(series_id,
 (SELECT jsonb_agg(jsonb_build_object('user_id',f.user_id,'subject','Recurring stale fixture','location','Old room','representative','','phone','',
 'request_date',('2027-02-01'::date+n*7)::text,'start_time','09:00','end_time','10:00','status','archived','status_type','scheduled',
 'participant_user_ids',jsonb_build_array(f.recipient_id),'repeat_type','weekly')) FROM stale_series_fixture f CROSS JOIN generate_series(0,2)n),
 '[]','هر هفته') FROM stale_series_fixture;
UPDATE public.meetings SET location='Changed room' WHERE series_id=(SELECT series_id FROM stale_series_fixture) AND request_date='2027-02-01';
-- Re-encoding the same Tehran date must not suppress still-valid occurrences.
UPDATE public.meetings SET request_date=((request_local_date::timestamp AT TIME ZONE 'Asia/Tehran')+interval '3 hours')::text
WHERE series_id=(SELECT series_id FROM stale_series_fixture) AND location='Old room';
SELECT set_config('spark.series_pattern','',true);
CREATE TEMP TABLE stale_claim AS SELECT j FROM public.claim_meeting_notification_jobs(100) j
WHERE j->>'series_id'=(SELECT series_id::text FROM stale_series_fixture);
DO $test$
DECLARE r jsonb;
BEGIN
 SELECT j INTO r FROM stale_claim WHERE j->>'event_type'='series_invite' AND j->>'recipient_id'=(SELECT recipient_id::text FROM stale_series_fixture);
 ASSERT r IS NOT NULL,'Original invite disappeared after equivalent date re-encoding';
 ASSERT (r->'context'->>'occurrence_count')::integer=2,'Stale occurrence remained in summary';
 ASSERT r->'context'->>'meeting_date'=private.format_jalali_date('2027-02-08'::date),'Summary first date is stale';
 ASSERT r->'context'->>'series_pattern'='هر هفته','Pattern snapshot was lost';
 ASSERT (SELECT jsonb_array_length(meetings) FROM private.meeting_notification_jobs WHERE id=(r->>'id')::uuid)=2,'Stored snapshot was not pruned';
 ASSERT EXISTS(SELECT FROM stale_claim WHERE j->>'event_type'='series_change' AND (j->'context'->>'occurrence_count')::integer=1),'Affected occurrence change missing';
END $test$;
DELETE FROM public.meetings WHERE series_id=(SELECT series_id FROM stale_series_fixture);
CREATE TEMP TABLE cancellation_claim AS SELECT j FROM public.claim_meeting_notification_jobs(100) j
WHERE j->>'series_id'=(SELECT series_id::text FROM stale_series_fixture) AND j->>'event_type'='series_cancel';
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM cancellation_claim)=2,'Cancellation recipients missing';
 ASSERT NOT EXISTS(SELECT FROM cancellation_claim WHERE (j->'context'->>'occurrence_count')::integer<>3),'Deleted occurrence history was pruned';
END $test$;
-- An expired processing lease is uncertain and can never be claimed again.
UPDATE private.meeting_notification_jobs SET available_at=now()-interval '6 minutes'
WHERE id=(SELECT (j->>'id')::uuid FROM stale_claim WHERE j->>'event_type'='series_invite' AND j->>'recipient_id'=(SELECT recipient_id::text FROM stale_series_fixture));
DO $test$ BEGIN
 PERFORM public.claim_meeting_notification_jobs(100);
 ASSERT EXISTS(SELECT FROM private.meeting_notification_jobs WHERE id=(SELECT (j->>'id')::uuid FROM stale_claim
 WHERE j->>'event_type'='series_invite' AND j->>'recipient_id'=(SELECT recipient_id::text FROM stale_series_fixture)) AND status='uncertain' AND attempts=1),'Expired lease was resent or lost';
END $test$;
-- Configure only inside this rolled-back transaction; cron cannot see these secrets.
DO $test$
DECLARE digest_before bytea;
BEGIN
 PERFORM private.configure_meeting_notification_worker('https://example.invalid/functions/v1/meeting-notification-worker');
 digest_before:=extensions.digest(private.safe_vault_secret('meeting_notification_worker_token'),'sha256');
 PERFORM private.configure_meeting_notification_worker('https://example.invalid/functions/v1/meeting-notification-worker/');
 ASSERT digest_before=extensions.digest(private.safe_vault_secret('meeting_notification_worker_token'),'sha256'),'Idempotent setup rotated token';
 ASSERT (SELECT count(*) FROM vault.secrets WHERE name='meeting_notification_worker_token')=1,'Duplicate token secrets';
 ASSERT (SELECT count(*) FROM vault.secrets WHERE name='meeting_notification_worker_url')=1,'Duplicate URL secrets';
 BEGIN PERFORM private.configure_meeting_notification_worker('http://example.invalid/functions/v1/meeting-notification-worker');
 RAISE EXCEPTION 'Unsafe URL accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INVALID_MEETING_WORKER_URL' THEN RAISE; END IF; END;
END $test$;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE r jsonb;
BEGIN
 r:=public.get_recurring_notification_runtime_status();
 ASSERT (r->>'worker_configured')::boolean,'Configured runtime not recognized';
 ASSERT (r->>'cron_active')::boolean,'Cron missing';
 ASSERT NOT (r ? 'token') AND NOT(r ? 'worker_url') AND position('example.invalid' IN r::text)=0,'Runtime exposed worker configuration secrets';
 BEGIN PERFORM private.configure_meeting_notification_worker('https://example.invalid/functions/v1/meeting-notification-worker');
 RAISE EXCEPTION 'Browser configured worker'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
CREATE TEMP TABLE recipient_runtime_session AS SELECT gen_random_uuid() session_id;
INSERT INTO auth.sessions(id,user_id,created_at,updated_at,aal)
SELECT s.session_id,f.recipient_id,now(),now(),'aal1' FROM recipient_runtime_session s CROSS JOIN stale_series_fixture f;
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT s.session_id,f.recipient_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM recipient_runtime_session s CROSS JOIN stale_series_fixture f JOIN public.profiles p ON p.user_id=f.recipient_id;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.recipient_id,'session_id',s.session_id,'role','authenticated','aal','aal1')::text,true)
FROM stale_series_fixture f CROSS JOIN recipient_runtime_session s;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
 ASSERT private.is_current_session_fully_authorized(),'Non-admin fixture must be FULL';
 BEGIN PERFORM public.get_recurring_notification_runtime_status();
 RAISE EXCEPTION 'Non-admin runtime read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SELECT 'recurring snapshot refresh, cancellation history, uncertain leases and runtime setup passed' result;
ROLLBACK;
