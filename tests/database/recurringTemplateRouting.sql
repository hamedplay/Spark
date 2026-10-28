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

-- Custom templates must control both title/body, with exact audience before all.
UPDATE public.notification_templates SET title='عنوان سفارشی {{meeting_subject}}',body='همه: {{series_start_date}} تا {{series_end_date}}؛ {{occurrence_count}} نوبت'
WHERE category='meeting' AND event_type='series_invite' AND audience='all';
INSERT INTO public.notification_templates(category,event_type,audience,title,body)
VALUES('meeting','series_invite','participants','دعوت اختصاصی {{meeting_subject}}','مخاطب: {{full_name}}، {{occurrence_count}} نوبت، {{meeting_time}}')
ON CONFLICT(category,event_type,audience) DO UPDATE SET title=excluded.title,body=excluded.body,is_active=true;
SELECT public.create_meeting_series(series_id,
 (SELECT jsonb_agg(jsonb_build_object('user_id',f.user_id,'subject','Recurring stale fixture','location','Old room','representative','','phone','',
 'request_date',('2027-02-01'::date+n*7)::text,'start_time','09:00','end_time','10:00','status','archived','status_type','scheduled',
 'participant_user_ids',jsonb_build_array(f.recipient_id),'repeat_type','weekly')) FROM stale_series_fixture f CROSS JOIN generate_series(0,2)n),
 '[]','هر هفته') FROM stale_series_fixture;

DO $$ DECLARE s uuid:=(SELECT series_id FROM stale_series_fixture); r jsonb; BEGIN
 ASSERT (SELECT count(*) FROM public.notifications WHERE metadata->>'series_id'=s::text)=2,'one invitation per recipient, not per occurrence';
 ASSERT EXISTS(SELECT FROM public.notifications WHERE metadata->>'series_id'=s::text AND user_id=(SELECT recipient_id FROM stale_series_fixture)
 AND title='دعوت اختصاصی Recurring stale fixture' AND message LIKE 'مخاطب: Recurring stale fixture recipient، 3 نوبت، 09:00 تا 10:00' AND template_id IS NOT NULL),'exact audience template not rendered';
 ASSERT EXISTS(SELECT FROM public.notifications WHERE metadata->>'series_id'=s::text AND title='عنوان سفارشی Recurring stale fixture' AND message LIKE 'همه:%3 نوبت'),'all audience fallback not rendered';
 ASSERT NOT EXISTS(SELECT FROM public.notifications WHERE metadata->>'series_id'=s::text AND message LIKE '%{{%'),'unresolved variable';
 ASSERT NOT EXISTS(SELECT FROM private.meeting_notification_jobs WHERE series_id=s AND (context->>'series_start_date' IS NULL OR context->>'series_end_date' IS NULL OR context->>'meeting_time' IS NULL)),'SMS fields absent';
 ASSERT (SELECT count(*) FROM private.meeting_notification_jobs WHERE series_id=s AND status='pending')=2,'SMS queue missing';
END $$;
-- Disabled notification templates suppress only that channel, not the SMS job.
UPDATE public.notification_templates SET is_active=false WHERE category='meeting' AND event_type='series_change';
UPDATE public.meetings SET location='New room' WHERE series_id=(SELECT series_id FROM stale_series_fixture);
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT FROM public.notifications WHERE metadata->>'series_id'=(SELECT series_id::text FROM stale_series_fixture) AND template_event_type='series_change'),'disabled template ignored';
 ASSERT (SELECT count(*) FROM private.meeting_notification_jobs WHERE series_id=(SELECT series_id FROM stale_series_fixture) AND event_type='series_change')=2,'disabled in-app template suppressed SMS';
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.configure_recurring_notification_delivery('https://example.invalid');
 ASSERT r->>'worker_configured'='true','setup failed';
 ASSERT r->>'cron_active'='true','cron not active';
 ASSERT r::text NOT LIKE '%example.invalid%' AND r::text NOT LIKE '%token%','setup leaks secrets';
 BEGIN PERFORM public.configure_recurring_notification_delivery('http://example.invalid');
 RAISE EXCEPTION 'Unsafe origin accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INVALID_DEPLOYMENT_ORIGIN' THEN RAISE; END IF; END;
 BEGIN PERFORM public.configure_recurring_notification_delivery('https://example.invalid/path');
 RAISE EXCEPTION 'Path accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INVALID_DEPLOYMENT_ORIGIN' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
-- Same FULL session, no admin privileges: configuration must remain denied.
UPDATE public.profiles SET is_admin=false WHERE user_id=(SELECT user_id FROM stale_series_fixture);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.configure_recurring_notification_delivery('https://example.invalid');
 RAISE EXCEPTION 'Nonadmin accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.configure_recurring_notification_delivery('https://example.invalid');
 RAISE EXCEPTION 'No session accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.configure_recurring_notification_delivery('https://example.invalid');
 RAISE EXCEPTION 'Anon accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'recurring template selection, customized content, channel isolation and admin setup passed' AS result;
ROLLBACK;
