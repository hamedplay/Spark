-- Run as a test database superuser. All fixtures, notifications and push queue entries
-- are rolled back, so this test never sends real notifications.
BEGIN;
DO $test$
DECLARE
  v_user uuid; v_due uuid := gen_random_uuid(); v_future uuid := gen_random_uuid();
  v_archived uuid := gen_random_uuid(); v_deleted uuid := gen_random_uuid();
  v_replication text := current_setting('session_replication_role');
  v_count integer;
BEGIN
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'TEST_REQUIRES_ONE_USER'; END IF;
  -- Seed overdue fixtures without weakening production schedule validation.
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.notes(id,user_id,title,content,status,remind_at) VALUES
    (v_due,v_user,'reminder-test-due','test','active',now()-interval '1 minute'),
    (v_future,v_user,'reminder-test-future','test','active',now()+interval '2 days'),
    (v_archived,v_user,'reminder-test-archived','test','archived',now()-interval '1 minute'),
    (v_deleted,v_user,'reminder-test-deleted','test','active',now()-interval '1 minute');
  PERFORM set_config('session_replication_role', v_replication, true);
  DELETE FROM public.notes WHERE id=v_deleted;
  PERFORM private.process_due_note_reminders(1000);
  SELECT count(*) INTO v_count FROM public.notifications WHERE entity_id=v_due AND type='note';
  IF v_count <> 1 THEN RAISE EXCEPTION 'DUE_REMINDER_MISSING_OR_DUPLICATED'; END IF;
  IF EXISTS(SELECT FROM public.notes WHERE id=v_due AND reminder_sent_at IS NULL) THEN
    RAISE EXCEPTION 'DELIVERY_NOT_MARKED';
  END IF;
  IF EXISTS(SELECT FROM public.notifications WHERE entity_id IN(v_future,v_archived,v_deleted)) THEN
    RAISE EXCEPTION 'CANCELLED_OR_FUTURE_REMINDER_SENT';
  END IF;
  -- Verify the existing push trigger receives the newly created notification.
  IF coalesce((SELECT notifications_enabled FROM public.user_preferences WHERE user_id=v_user),true)
     AND NOT EXISTS(SELECT FROM public.pwa_push_outbox p JOIN public.notifications n ON n.id=p.notification_id WHERE n.entity_id=v_due) THEN
    RAISE EXCEPTION 'PUSH_OUTBOX_NOT_ENQUEUED';
  END IF;
  PERFORM private.process_due_note_reminders(1000);
  IF (SELECT count(*) FROM public.notifications WHERE entity_id=v_due) <> 1 THEN
    RAISE EXCEPTION 'RETRY_DUPLICATED_REMINDER';
  END IF;
  UPDATE public.notes SET content='edited after delivery' WHERE id=v_due;
  IF EXISTS(SELECT FROM public.notes WHERE id=v_due AND reminder_sent_at IS NULL) THEN
    RAISE EXCEPTION 'TEXT_EDIT_REARMED_REMINDER';
  END IF;
  UPDATE public.notes SET remind_at=now()+interval '3 days' WHERE id=v_due;
  IF EXISTS(SELECT FROM public.notes WHERE id=v_due AND reminder_sent_at IS NOT NULL) THEN
    RAISE EXCEPTION 'RESCHEDULE_DID_NOT_REARM';
  END IF;
  UPDATE public.notes SET remind_at=NULL WHERE id=v_due;
  UPDATE public.notes SET status='archived' WHERE id=v_future;
  IF EXISTS(SELECT FROM public.notes WHERE id IN(v_due,v_future) AND remind_at IS NOT NULL) THEN
    RAISE EXCEPTION 'CANCEL_OR_ARCHIVE_DID_NOT_CLEAR_SCHEDULE';
  END IF;
  BEGIN
    UPDATE public.notes SET remind_at=now()-interval '1 minute' WHERE id=v_due;
    RAISE EXCEPTION 'PAST_DATE_ACCEPTED';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    UPDATE public.notes SET remind_at='infinity'::timestamptz WHERE id=v_due;
    RAISE EXCEPTION 'INFINITE_DATE_ACCEPTED';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF has_function_privilege('authenticated','private.process_due_note_reminders(integer)','EXECUTE')
     OR has_function_privilege('anon','private.process_due_note_reminders(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'WORKER_EXPOSED_TO_CLIENTS';
  END IF;
END $test$;
ROLLBACK;
SELECT 'note_reminders_integration_passed' AS result;
