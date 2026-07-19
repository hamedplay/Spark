/*
# Minutes Phase 3 — corrective: make minute_resubmitted robust

Bug: resubmit detection relied on submitted_at changing. Within a single
transaction, now() is constant, so submitted_at didn't change and the
resubmit branch fell through to minute_updated. In production with
separate transactions this works, but the trigger should be robust.

Fix: detect resubmit by revision_number increase when status becomes
pending_approval (covers both same-tx and cross-tx cases). minute_submitted
fires only when status becomes pending_approval AND revision_number did
NOT increase (initial submit).
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

  v_rev := NEW.revision_number;
  v_meta := NULL;
  v_action := 'minute_updated';

  IF NEW.status = 'published' AND OLD.status <> 'published'
     AND NEW.published_at IS NOT NULL THEN
    v_action := 'minute_published';
  ELSIF NEW.status = 'pending_approval' AND OLD.status <> 'pending_approval'
     AND NEW.revision_number <= COALESCE(OLD.revision_number, 0) THEN
    v_action := 'minute_submitted';
  ELSIF NEW.status = 'pending_approval'
     AND NEW.revision_number > COALESCE(OLD.revision_number, 0) THEN
    v_action := 'minute_resubmitted';
  ELSIF NEW.status = 'changes_requested' AND OLD.status <> 'changes_requested' THEN
    v_action := 'changes_requested';
  ELSIF NEW.secretary_confirmed_at IS DISTINCT FROM OLD.secretary_confirmed_at
     AND NEW.secretary_confirmed_at IS NOT NULL THEN
    v_action := 'secretary_confirmed';
  ELSIF NEW.chair_confirmed_at IS DISTINCT FROM OLD.chair_confirmed_at
     AND NEW.chair_confirmed_at IS NOT NULL THEN
    v_action := 'chair_confirmed';
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
