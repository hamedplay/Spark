/*
# Minutes Phase 3 — Audit triggers

Populates minutes_audit_log automatically from minutes + minutes_decisions
changes, WITHOUT rewriting the existing RPC function bodies. The existing
SECURITY DEFINER RPCs already update the minutes row's status/timestamps,
so a trigger can infer the action from OLD vs NEW column values and call the
append-only _write_minutes_audit helper. auth.uid() is available inside the
trigger (runs in the caller's session context).

## Triggers
- minutes_audit_on_write: AFTER INSERT/UPDATE/DELETE on minutes
  - INSERT -> minute_created
  - DELETE -> minute_deleted
  - UPDATE: infer action from status + timestamp changes:
      status pending_approval + submitted_at changed -> minute_submitted
      status changes_requested -> changes_requested
      status pending_approval + submitted_at changed (resubmit) -> minute_resubmitted
      secretary_confirmed_at changed -> secretary_confirmed
      chair_confirmed_at changed -> chair_confirmed
      status published + published_at changed -> minute_published
      else -> minute_updated
- minutes_decisions_audit_on_write: AFTER INSERT/UPDATE/DELETE on minutes_decisions
  - INSERT -> decision_created
  - DELETE -> decision_deleted
  - UPDATE -> decision_updated (progress_percent or status changed)
    Also writes decision_progress_updated when progress_percent changes.

Both trigger functions are SECURITY DEFINER SET search_path='' so they can
call the internal audit helper. They are attached via CREATE TRIGGER.
Idempotency: CREATE OR REPLACE for the functions; DROP TRIGGER IF EXISTS
before CREATE TRIGGER.
*/

CREATE OR REPLACE FUNCTION public._minutes_audit_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_action text;
  v_rev int;
  v_meta jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._write_minutes_audit(
      NEW.id, 'minute_created', 'minute', NEW.id, NEW.revision_number,
      NULL, jsonb_build_object('title', NEW.meeting_title_snapshot, 'status', NEW.status), NULL
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public._write_minutes_audit(
      OLD.id, 'minute_deleted', 'minute', OLD.id, OLD.revision_number,
      jsonb_build_object('title', OLD.meeting_title_snapshot, 'status', OLD.status), NULL, NULL
    );
    RETURN OLD;
  END IF;

  -- UPDATE: infer action
  v_rev := NEW.revision_number;
  v_meta := NULL;
  v_action := 'minute_updated';

  IF OLD.status <> 'pending_approval' AND NEW.status = 'pending_approval'
     AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    v_action := 'minute_submitted';
  ELSIF OLD.status = 'pending_approval' AND NEW.status = 'pending_approval'
     AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     AND NEW.revision_number > OLD.revision_number THEN
    v_action := 'minute_resubmitted';
  ELSIF NEW.status = 'changes_requested' AND OLD.status <> 'changes_requested' THEN
    v_action := 'changes_requested';
  ELSIF NEW.secretary_confirmed_at IS DISTINCT FROM OLD.secretary_confirmed_at
     AND NEW.secretary_confirmed_at IS NOT NULL THEN
    v_action := 'secretary_confirmed';
  ELSIF NEW.chair_confirmed_at IS DISTINCT FROM OLD.chair_confirmed_at
     AND NEW.chair_confirmed_at IS NOT NULL THEN
    v_action := 'chair_confirmed';
  ELSIF NEW.status = 'published' AND OLD.status <> 'published'
     AND NEW.published_at IS NOT NULL THEN
    v_action := 'minute_published';
  END IF;

  PERFORM public._write_minutes_audit(
    NEW.id, v_action, 'minute', NEW.id, v_rev,
    jsonb_build_object('status', OLD.status, 'revision', OLD.revision_number),
    jsonb_build_object('status', NEW.status, 'revision', NEW.revision_number),
    v_meta
  );
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._minutes_audit_trigger_fn() FROM anon, authenticated;

DROP TRIGGER IF EXISTS tr_minutes_audit ON public.minutes;
CREATE TRIGGER tr_minutes_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.minutes
  FOR EACH ROW EXECUTE FUNCTION public._minutes_audit_trigger_fn();

-- ── Decisions audit trigger ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._minutes_decisions_audit_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_action text;
  v_progress_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._write_minutes_audit(
      NEW.minute_id, 'decision_created', 'decision', NEW.id, NULL,
      NULL, jsonb_build_object('title', NEW.title, 'status', NEW.status), NULL
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public._write_minutes_audit(
      OLD.minute_id, 'decision_deleted', 'decision', OLD.id, NULL,
      jsonb_build_object('title', OLD.title, 'status', OLD.status), NULL, NULL
    );
    RETURN OLD;
  END IF;

  v_progress_changed := (NEW.progress_percent IS DISTINCT FROM OLD.progress_percent)
    OR (NEW.status IS DISTINCT FROM OLD.status);
  v_action := CASE WHEN v_progress_changed THEN 'decision_progress_updated' ELSE 'decision_updated' END;

  PERFORM public._write_minutes_audit(
    NEW.minute_id, v_action, 'decision', NEW.id, NULL,
    jsonb_build_object('status', OLD.status, 'progress', OLD.progress_percent),
    jsonb_build_object('status', NEW.status, 'progress', NEW.progress_percent),
    NULL
  );
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._minutes_decisions_audit_trigger_fn() FROM anon, authenticated;

DROP TRIGGER IF EXISTS tr_minutes_decisions_audit ON public.minutes_decisions;
CREATE TRIGGER tr_minutes_decisions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.minutes_decisions
  FOR EACH ROW EXECUTE FUNCTION public._minutes_decisions_audit_trigger_fn();
