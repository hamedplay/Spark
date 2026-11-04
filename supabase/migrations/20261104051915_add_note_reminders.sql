-- One reminder per personal note; delivery is independent of an open browser.
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS remind_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS notes_pending_reminder_idx ON public.notes (remind_at, id)
  WHERE status = 'active' AND remind_at IS NOT NULL AND reminder_sent_at IS NULL;

CREATE OR REPLACE FUNCTION private.prepare_note_reminder()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF NEW.status = 'archived' THEN
    NEW.remind_at := NULL;
    NEW.reminder_sent_at := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.reminder_sent_at := NULL;
  ELSIF NEW.remind_at IS NOT DISTINCT FROM OLD.remind_at THEN
    -- Editing the text must neither re-arm nor invalidate a delivered reminder.
    RETURN NEW;
  ELSE
    NEW.reminder_sent_at := NULL;
  END IF;
  IF NEW.remind_at IS NOT NULL
     AND (NOT isfinite(NEW.remind_at) OR NEW.remind_at <= now()) THEN
    RAISE EXCEPTION 'تاریخ و ساعت یادآوری باید در آینده باشد' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION private.prepare_note_reminder() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER notes_prepare_reminder BEFORE INSERT OR UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION private.prepare_note_reminder();

CREATE OR REPLACE FUNCTION private.process_due_note_reminders(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_note record; v_count integer := 0;
BEGIN
  -- Lock and mark in the same transaction as notification creation. Concurrent
  -- ticks skip locked rows; a failed transaction can retry without duplicates.
  FOR v_note IN
    SELECT id, user_id, title, remind_at FROM public.notes
    WHERE status = 'active' AND remind_at <= now() AND reminder_sent_at IS NULL
    ORDER BY remind_at, id
    LIMIT greatest(1, least(coalesce(p_limit, 100), 1000))
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.notifications
      (user_id, title, message, type, action_url, entity_type, entity_id,
       template_category, template_event_type, metadata)
    VALUES
      (v_note.user_id, 'یادآوری یادداشت',
       'زمان یادآوری یادداشت «' || left(coalesce(v_note.title, ''), 200) || '» فرا رسیده است.',
       'note', 'notes', 'note', v_note.id, 'note', 'reminder',
       jsonb_build_object('note_id', v_note.id, 'remind_at', v_note.remind_at));
    -- The existing notifications trigger also enqueues PWA push delivery.
    UPDATE public.notes SET reminder_sent_at = now() WHERE id = v_note.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$;
REVOKE ALL ON FUNCTION private.process_due_note_reminders(integer) FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule('spark-note-reminders', '* * * * *', 'SELECT private.process_due_note_reminders();');
NOTIFY pgrst, 'reload schema';
