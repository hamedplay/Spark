-- Run only on a test/copy DB as postgres. Everything, including queues, rolls back. The scheduler and delivery transports are not invoked.
BEGIN;
DO $test$
DECLARE
 users uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 sessions uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 i integer; n uuid; second_note uuid; shared uuid; second_shared uuid; confidential uuid; due_note uuid;
 payload jsonb; j record; saved_name text; v_claim jsonb; v_message text;

BEGIN
 -- Local lifecycle marker is used only to seed test profiles; all fixtures roll back.
 PERFORM set_config('app.account_lifecycle_write','true',true);
 FOR i IN 1..4 LOOP
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(users[i],'note-message-test-'||users[i]||'@example.invalid',jsonb_build_object('full_name','آزمایش یادداشت'));
  INSERT INTO public.profiles(user_id) VALUES(users[i]) ON CONFLICT(user_id) DO NOTHING;
  UPDATE public.profiles SET username='note-test-'||users[i],full_name=CASE i WHEN 1 THEN 'حامد عرب خالقی' WHEN 2 THEN 'مدیر گیرنده'
   WHEN 3 THEN 'فرستنده دوم' ELSE 'کاربر سازمان دیگر' END,
   organization=CASE WHEN i=4 THEN users[4]::text ELSE users[1]::text END,is_active=true,account_status='ACTIVE',
   profile_completion_status='COMPLETE',mfa_method='totp',mfa_enrollment_required=false,is_hidden=false WHERE user_id=users[i];
  INSERT INTO auth.sessions(id,user_id,aal,created_at,not_after) VALUES(sessions[i],users[i],'aal2',now(),now()+interval '1 day');
  INSERT INTO auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
   VALUES(gen_random_uuid(),users[i],'totp','verified',now(),now());
  INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
   VALUES(sessions[i],users[i],1,now()+interval '1 day',now()+interval '1 day') ON CONFLICT(session_id) DO NOTHING;
 END LOOP;
 PERFORM set_config('app.account_lifecycle_write','false',true);
 v_claim:=jsonb_build_object('sub',users[1],'session_id',sessions[1],'role','authenticated','aal','aal2');
 PERFORM set_config('request.jwt.claims',v_claim::text,true);
 IF NOT private.is_current_session_fully_authorized() THEN RAISE EXCEPTION 'TEST_SESSION_NOT_AUTHORIZED'; END IF;
 INSERT INTO public.notes(user_id,title,content,status,remind_at,reminder_user_ids,creator_name)
 VALUES(users[1],'عنوان آزمایشی',E'سطر اول\nسطر دوم بدون تغییر','active',now()+interval '2 days',ARRAY[users[2]],'نام جعلی') RETURNING id INTO n;
 IF (SELECT creator_name FROM public.notes WHERE id=n)<>'حامد عرب خالقی' THEN RAISE EXCEPTION 'CREATOR_SPOOF_ACCEPTED'; END IF;
 UPDATE public.notes SET creator_name='سامانه',reminder_creator_name='سرویس خودکار' WHERE id=n;
 IF (SELECT reminder_creator_name FROM public.notes WHERE id=n)<>'حامد عرب خالقی' THEN RAISE EXCEPTION 'IDENTITY_MUTABLE'; END IF;
 -- Actual public sharing API under the same role as the frontend.
 EXECUTE 'SET LOCAL ROLE authenticated';
 shared:=public.share_note_v2(n,users[2]);
 EXECUTE 'RESET ROLE';
 IF (SELECT creator_id FROM public.notes WHERE id=shared)<>users[1] THEN RAISE EXCEPTION 'SHARE_LOST_SENDER'; END IF;
 SELECT message INTO v_message FROM public.notifications WHERE entity_id=shared AND user_id=users[2];
 IF v_message<>private.note_message('share','حامد عرب خالقی',E'سطر اول\nسطر دوم بدون تغییر','') THEN RAISE EXCEPTION 'SHARE_MESSAGE_CHANGED'; END IF;
 IF (SELECT count(*) FROM private.note_reminder_deliveries WHERE note_id=shared)<>2 THEN RAISE EXCEPTION 'SHARE_NOT_ATOMIC'; END IF;
 -- A second sender sharing to the same manager stays independently identifiable.
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[3],'session_id',sessions[3],'role','authenticated','aal','aal2')::text,true);
 INSERT INTO public.notes(user_id,title,content,status) VALUES(users[3],'دوم','متن دوم','active') RETURNING id INTO second_note;
 second_shared:=public.share_note_v2(second_note,users[2]);
 IF NOT EXISTS(SELECT FROM public.notifications WHERE entity_id=second_shared AND sender_name='فرستنده دوم') THEN RAISE EXCEPTION 'SENDERS_MIXED'; END IF;
 BEGIN PERFORM public.get_note_message_details(n); RAISE EXCEPTION 'OTHER_NOTE_DETAILS_EXPOSED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- The receiver creates their own reminder on a shared copy; the original note sender is retained separately.
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[2],'session_id',sessions[2],'role','authenticated','aal','aal2')::text,true);
 UPDATE public.notes SET remind_at=now()+interval '1 day' WHERE id=shared;
 IF NOT EXISTS(SELECT FROM public.notes WHERE id=shared AND creator_name='حامد عرب خالقی' AND reminder_creator_name='مدیر گیرنده') THEN
  RAISE EXCEPTION 'SHARED_COPY_REMINDER_IDENTITY_WRONG'; END IF;
 payload:=public.get_note_message_details(shared);
 IF payload->>'creator_name'<>'حامد عرب خالقی' OR payload->>'reminder_creator_name'<>'مدیر گیرنده' THEN RAISE EXCEPTION 'DETAILS_MISSING'; END IF;
 -- Exercise the same durable enqueue helper used by the scheduler, without a human JWT.
 PERFORM set_config('request.jwt.claims','{}',true);
 PERFORM private.enqueue_note_message(n,users[1],'reminder');
 PERFORM private.enqueue_note_message(n,users[2],'reminder');
 PERFORM private.enqueue_note_message(shared,users[2],'reminder');
 IF NOT EXISTS(SELECT FROM public.notifications WHERE entity_id=n AND user_id=users[2]
  AND sender_id=users[1] AND sender_name='حامد عرب خالقی' AND message LIKE '%زمان یادآوری:%'
  AND message LIKE E'%سطر اول\nسطر دوم بدون تغییر%') THEN RAISE EXCEPTION 'SCHEDULER_LOST_HUMAN_OR_BODY'; END IF;
 IF NOT EXISTS(SELECT FROM public.notifications WHERE entity_id=shared AND template_event_type='reminder' AND sender_name='مدیر گیرنده') THEN RAISE EXCEPTION 'REMINDER_CREATOR_WRONG'; END IF;
 IF private.note_reminder_time('2026-11-07T05:30:00Z')<>'۱۴۰۵/۰۸/۱۶ ۰۹:۰۰' THEN RAISE EXCEPTION 'TEHRAN_JALALI_TIME_WRONG'; END IF;
 -- Current privacy is enforced at send time for already queued multipart content.
 UPDATE public.notes SET sms_include_content=false WHERE id=n;
 FOR j IN SELECT id,channel FROM private.note_reminder_deliveries WHERE note_id=n LOOP
  UPDATE private.note_reminder_deliveries SET status='sending',lease=gen_random_uuid() WHERE id=j.id;
  SELECT public.get_note_delivery_envelope(id,lease) INTO payload FROM private.note_reminder_deliveries WHERE id=j.id;
  IF payload IS NULL OR payload::text LIKE '%سطر اول%' OR payload::text LIKE '%عنوان آزمایشی%' OR payload->>'message' NOT LIKE '%حامد عرب خالقی%' THEN
   RAISE EXCEPTION 'QUEUED_PRIVATE_CONTENT_LEAK'; END IF;
 END LOOP;
 -- Removing a recipient revokes even an already claimed envelope.
 UPDATE public.notes SET reminder_user_ids='{}' WHERE id=n;
 SELECT public.get_note_delivery_envelope(id,lease) INTO payload FROM private.note_reminder_deliveries WHERE note_id=n AND recipient_id=users[2] LIMIT 1;
 IF payload IS NOT NULL THEN RAISE EXCEPTION 'REMOVED_RECIPIENT_CAN_SEND'; END IF;
 -- Sharing a confidential note inherits its privacy and keeps full text only inside the app.
 PERFORM set_config('request.jwt.claims',v_claim::text,true);
 confidential:=public.share_note_v2(n,users[2]);
 IF EXISTS(SELECT FROM private.note_reminder_deliveries WHERE note_id=confidential AND (message LIKE '%سطر اول%' OR note_title='عنوان آزمایشی' OR context::text LIKE '%سطر اول%')) THEN RAISE EXCEPTION 'SHARE_PRIVATE_CONTENT_LEAK'; END IF;
 IF NOT EXISTS(SELECT FROM public.notifications WHERE entity_id=confidential AND message LIKE '%سطر اول%') THEN RAISE EXCEPTION 'SECURE_BODY_LOST'; END IF;
 BEGIN PERFORM public.share_note_v2(n,users[4]); RAISE EXCEPTION 'CROSS_ORG_SHARE_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.share_note_v2(second_note,users[2]); RAISE EXCEPTION 'OTHER_OWNER_SHARE_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM private.share_note_to_user('title','body','text',users[2],users[3]); RAISE EXCEPTION 'LEGACY_BYPASS_ALLOWED';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 -- Multipart text remains complete; restricting an existing queue sends just one generic part.
 INSERT INTO public.notes(user_id,title,content,status,remind_at)
 VALUES(users[1],'عنوان حساس طولانی',repeat('متن حساس ',900),'active',now()+interval '1 day') RETURNING id INTO due_note;
 PERFORM set_config('request.jwt.claims','{}',true);
 PERFORM private.enqueue_note_message(due_note,users[1],'reminder');
 SELECT string_agg(substring(message FROM position(E'\n' IN message)+1),'' ORDER BY part_index) INTO v_message
 FROM private.note_reminder_deliveries WHERE note_id=due_note AND channel='bale';
 IF v_message<>(SELECT private.note_message('reminder','حامد عرب خالقی',content,private.note_reminder_time(remind_at)) FROM public.notes WHERE id=due_note) THEN
  RAISE EXCEPTION 'MULTIPART_TEXT_TRUNCATED'; END IF;
 UPDATE public.notes SET sms_include_content=false WHERE id=due_note;
 FOR j IN SELECT id,part_index FROM private.note_reminder_deliveries WHERE note_id=due_note AND channel='bale' LOOP
  UPDATE private.note_reminder_deliveries SET status='sending',lease=gen_random_uuid() WHERE id=j.id;
  SELECT public.get_note_delivery_envelope(id,lease) INTO payload FROM private.note_reminder_deliveries WHERE id=j.id;
  IF j.part_index=1 AND (payload->>'message' LIKE '%متن حساس%' OR payload->>'message' NOT LIKE '%وارد سامانه شوید%') THEN RAISE EXCEPTION 'PART_ONE_NOT_REDACTED'; END IF;
  IF j.part_index>1 AND (payload->>'skip')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'REDACTED_PART_DUPLICATED'; END IF;
 END LOOP;
 IF has_function_privilege('authenticated','public.get_note_delivery_envelope(uuid,uuid)','EXECUTE')
  OR has_function_privilege('anon','public.share_note_v2(uuid,uuid)','EXECUTE')
  OR has_function_privilege('authenticated','private.enqueue_note_message(uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'PRIVATE_SENDER_API_EXPOSED'; END IF;
END $test$;
ROLLBACK;
SELECT 'note_sender_identity_integration_passed' AS result;
