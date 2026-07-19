/*
# Minutes Phase 3 — corrective: fix minute_resubmitted audit never logged

Bug: minute_resubmitted branch required OLD.status='pending_approval' AND
NEW.status='pending_approval'. But resubmit goes from changes_requested ->
pending_approval, so it never matched and fell through to minute_updated.

Fix: minute_resubmitted fires when status becomes pending_approval AND
submitted_at changed AND revision_number increased (covers both
pending_approval->pending_approval and changes_requested->pending_approval
resubmit paths). minute_submitted fires only for the initial draft ->
pending_approval transition (OLD.status <> 'pending_approval' AND
revision_number did not increase).
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
     AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     AND NEW.revision_number <= COALESCE(OLD.revision_number, 0) THEN
    v_action := 'minute_submitted';
  ELSIF NEW.status = 'pending_approval'
     AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
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
