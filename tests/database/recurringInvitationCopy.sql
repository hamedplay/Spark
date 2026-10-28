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
UPDATE public.profiles SET full_name='محمدی',gender='male' WHERE user_id=(SELECT recipient_id FROM stale_series_fixture);
SELECT public.create_meeting_series(series_id,
 (SELECT jsonb_agg(jsonb_build_object('user_id',f.user_id,'subject','شورای معاونت','location','Old room','representative','','phone','',
 'request_date',('2026-10-24'::date+n*7)::text,'start_time','09:00','end_time','10:00','status','archived','status_type','scheduled',
 'participant_user_ids',jsonb_build_array(f.recipient_id),'repeat_type','weekly')) FROM stale_series_fixture f CROSS JOIN generate_series(0,2)n),
 '[]','هر هفته') FROM stale_series_fixture;

DO $$ DECLARE c jsonb; female jsonb; monthly jsonb; interval_copy jsonb; BEGIN
 SELECT context INTO c FROM private.meeting_notification_jobs WHERE series_id=(SELECT series_id FROM stale_series_fixture) AND recipient_id=(SELECT recipient_id FROM stale_series_fixture);
 ASSERT c->>'formal_recipient_greeting'='جناب آقای محمدی','Male formal salutation';
 ASSERT c->>'series_weekdays'='شنبه‌ها','Tehran weekday';
 ASSERT c->>'recurrence_frequency'='هفتگی','Weekly frequency';
 ASSERT c->>'occurrence_count'='3','Actual count';
 ASSERT EXISTS(SELECT FROM public.notifications WHERE metadata->>'series_id'=(SELECT series_id::text FROM stale_series_fixture)
 AND title='دعوت به جلسات تکرارشونده' AND message LIKE '%شما به مجموعه جلسات «شورای معاونت» دعوت شده‌اید.%'
 AND message LIKE '%هفتگی، شنبه‌ها ساعت 09:00%' AND message LIKE '%تعداد جلسات برنامه‌ریزی‌شده: 3%'
 AND message NOT LIKE '%{{%'),'Invitation notification copy';
 UPDATE public.profiles SET full_name='محمدی',gender='female' WHERE user_id=(SELECT recipient_id FROM stale_series_fixture);
 SELECT private.meeting_series_message_context(meetings,event_type,recipient_id) INTO female FROM private.meeting_notification_jobs WHERE series_id=(SELECT series_id FROM stale_series_fixture) AND recipient_id=(SELECT recipient_id FROM stale_series_fixture);
 ASSERT female->>'formal_recipient_greeting'='سرکار خانم محمدی','Female formal salutation';
 monthly:=private.meeting_series_message_context('[{"request_date":"2026-10-24","repeat_type":"monthly","repeat_interval":1},{"request_date":"2026-11-24","repeat_type":"monthly","repeat_interval":1}]','series_invite',null);
 ASSERT monthly->>'recurrence_frequency'='ماهانه','Monthly frequency';
 ASSERT monthly->>'series_weekdays' LIKE '%شنبه‌ها%' AND monthly->>'series_weekdays' LIKE '%سه‌شنبه‌ها%','Monthly weekdays must reflect the actual dates';
 interval_copy:=private.meeting_series_message_context('[{"request_date":"2026-10-24","repeat_type":"weekly","repeat_interval":2}]','series_invite',null);
 ASSERT interval_copy->>'recurrence_frequency'='هر ۲ هفته','Non-unit interval';
 ASSERT interval_copy->>'formal_recipient_greeting'='همکار گرامی','Unknown recipient has neutral greeting';
 ASSERT (SELECT body FROM public.sms_templates WHERE category='meeting' AND event_type='series_invite' AND audience='all') LIKE '%روز برگزاری: {{series_weekdays}}%','SMS copy';
 ASSERT (SELECT body FROM public.sms_templates WHERE category='meeting' AND event_type='series_invite' AND audience='all') LIKE '%جزئیات و برنامه جلسات در تقویم سامانه اسپارک قابل مشاهده است.%','SMS closing';
END $$;
SELECT 'recurring invitation copy, profile salutations, actual weekdays and recurrence intervals passed' AS result;
ROLLBACK;
