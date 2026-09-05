-- Decision follow-up updates store raw metadata as method/result/next_followup_date,
-- while notification templates consume canonical followup_* placeholders.
-- Normalize those aliases at the producer boundary so follow-up events can
-- enter notification_outbox instead of being silently rejected by rendering.
CREATE OR REPLACE FUNCTION private.queue_decision_update_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_event_key text;
  v_owner_id uuid;
  v_secretary_id uuid;
  v_revision integer;
  v_decision_title text;
  v_owner_name text;
  v_actor_name text;
  v_minute_title text;
  v_due_date date;
  v_context jsonb;
  v_seed_recipient uuid;
BEGIN
  v_event_key := CASE NEW.event_type
    WHEN 'progress' THEN 'decision_progress_updated'
    WHEN 'status_change' THEN 'decision_status_changed'
    WHEN 'report' THEN 'decision_report_added'
    WHEN 'obstacle' THEN 'decision_obstacle'
    WHEN 'obstacle_resolved' THEN 'decision_obstacle_resolved'
    WHEN 'followup' THEN 'decision_followup'
    WHEN 'completion' THEN 'decision_completed'
    WHEN 'reopened' THEN 'decision_reopened'
    ELSE NULL
  END;

  IF v_event_key IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT d.primary_owner_user_id,
         d.title,
         d.due_date,
         m.secretary_user_id,
         m.revision_number,
         m.meeting_title_snapshot
  INTO v_owner_id,
       v_decision_title,
       v_due_date,
       v_secretary_id,
       v_revision,
       v_minute_title
  FROM public.minutes_decisions d
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE d.id = NEW.decision_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_owner_name := COALESCE(
    (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles p WHERE p.user_id = v_owner_id LIMIT 1),
    (SELECT NULLIF(btrim(d.external_responsible_name_snapshot), '') FROM public.minutes_decisions d WHERE d.id = NEW.decision_id),
    'مسئول مصوبه'
  );
  v_actor_name := COALESCE(
    (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles p WHERE p.user_id = NEW.created_by_user_id LIMIT 1),
    'کاربر'
  );

  v_context := COALESCE(NEW.event_metadata, '{}'::jsonb) || jsonb_build_object(
    'decision_id', NEW.decision_id,
    'decision_title', COALESCE(v_decision_title, ''),
    'decision_status', COALESCE(NEW.new_status, ''),
    'previous_decision_status', COALESCE(NEW.previous_status, ''),
    'decision_progress', COALESCE(NEW.new_progress_percent::text, ''),
    'decision_owner_name', COALESCE(v_owner_name, ''),
    'decision_due_date', COALESCE(v_due_date::text, ''),
    'minute_title', COALESCE(v_minute_title, ''),
    'obstacle_title', COALESCE(NEW.event_title, NEW.event_metadata->>'obstacle_title', ''),
    'report_text', COALESCE(NEW.update_text, ''),
    'actor_name', v_actor_name,
    'followup_method', COALESCE(NEW.event_metadata->>'followup_method', NEW.event_metadata->>'method', ''),
    'followup_date', COALESCE(NEW.event_metadata->>'followup_date', NEW.event_metadata->>'next_followup_date', ''),
    'followup_result', COALESCE(NEW.event_metadata->>'followup_result', NEW.event_metadata->>'result', NEW.update_text, '')
  );

  v_seed_recipient := COALESCE(v_owner_id, v_secretary_id);
  IF v_seed_recipient IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.resolve_and_queue_notification(
    v_event_key,
    v_seed_recipient,
    CASE WHEN v_seed_recipient = v_owner_id THEN 'decision_owner' ELSE 'secretary' END,
    'decision',
    NEW.decision_id,
    NEW.minute_id,
    NEW.created_by_user_id,
    v_context,
    'decision:' || NEW.decision_id::text || ':' || v_event_key || ':' || NEW.id::text,
    v_revision
  );

  RETURN NEW;
END;
$function$;
