-- Recovery migration: safe after a rolled-back, partial or completed initial installation.
-- Intentionally includes the prerequisites; run this file instead of retrying the old file.
-- Represent an explicit admin publication without fabricating chair/secretary signatures.
ALTER TABLE public.minutes ADD COLUMN IF NOT EXISTS admin_finalization jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.minutes ADD COLUMN IF NOT EXISTS admin_published_at timestamptz;
ALTER TABLE public.minutes ADD COLUMN IF NOT EXISTS admin_published_by_user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.minutes DROP CONSTRAINT IF EXISTS minutes_published_consistency_check;
ALTER TABLE public.minutes ADD CONSTRAINT minutes_published_consistency_check CHECK (
 status <> 'published' OR (chair_confirmed_at IS NOT NULL AND secretary_confirmed_at IS NOT NULL)
 OR (admin_published_at IS NOT NULL AND admin_published_by_user_id IS NOT NULL)
);
CREATE OR REPLACE FUNCTION private.guard_minutes_admin_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.admin_published_at IS NULL AND NEW.admin_published_by_user_id IS NULL AND NEW.admin_finalization='{}'::jsonb THEN RETURN NEW; END IF;
 ELSE
   IF NEW.admin_published_at IS NOT DISTINCT FROM OLD.admin_published_at
      AND NEW.admin_published_by_user_id IS NOT DISTINCT FROM OLD.admin_published_by_user_id
      AND NEW.admin_finalization IS NOT DISTINCT FROM OLD.admin_finalization THEN RETURN NEW; END IF;
 END IF;
 IF auth.uid() IS NULL OR NOT public.is_current_user_admin()
    OR (public.get_my_auth_access_state()->>'access_level') IS DISTINCT FROM 'FULL' THEN
   RAISE EXCEPTION 'ADMIN_FULL_ACCESS_REQUIRED';
 END IF;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION private.guard_minutes_admin_publication() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_minutes_admin_publication ON public.minutes;
CREATE TRIGGER guard_minutes_admin_publication BEFORE INSERT OR UPDATE ON public.minutes
FOR EACH ROW EXECUTE FUNCTION private.guard_minutes_admin_publication();

-- Direct administrative correction: separate API, no widening of ordinary edit rights.
CREATE OR REPLACE FUNCTION private.admin_minutes_snapshot(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
SELECT jsonb_build_object(
 'minute', to_jsonb(m),
 'participants', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]') FROM public.minutes_participants x WHERE x.minute_id=m.id),
 'external_participants', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]') FROM public.minutes_external_participants x WHERE x.minute_id=m.id),
 'agenda', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]') FROM public.minutes_agenda_results x WHERE x.minute_id=m.id),
 'decisions', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]') FROM public.minutes_decisions x WHERE x.minute_id=m.id),
 'approvals', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]') FROM public.minutes_approvals x WHERE x.minute_id=m.id)
) FROM public.minutes m WHERE m.id=p_id;
$fn$;
REVOKE ALL ON FUNCTION private.admin_minutes_snapshot(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.admin_correct_minutes(
 p_minute_id uuid, p_expected_updated_at timestamptz, p_payload jsonb,
 p_decisions jsonb, p_deleted_decision_ids uuid[], p_deleted_external_participant_ids uuid[],
 p_status text, p_reason text, p_signatories jsonb, p_decision_states jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
 m public.minutes%ROWTYPE; v_result jsonb; v_before jsonb; v_after jsonb;
 v_internal uuid[]; v_external uuid[]; v_state jsonb; v_status text; v_progress integer;
 v_updated timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_current_user_admin()
    OR (public.get_my_auth_access_state()->>'access_level') IS DISTINCT FROM 'FULL' THEN
   RAISE EXCEPTION 'ADMIN_FULL_ACCESS_REQUIRED';
 END IF;
 IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'CORRECTION_REASON_REQUIRED'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('draft','changes_requested','pending_approval','approved','published') THEN
   RAISE EXCEPTION 'INVALID_STATUS';
 END IF;
 IF jsonb_typeof(p_signatories) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_decision_states) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'PAYLOAD_INVALID'; END IF;
 SELECT * INTO m FROM public.minutes WHERE id=p_minute_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MINUTE_NOT_FOUND'; END IF;
 IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM m.updated_at THEN
   RAISE EXCEPTION 'MINUTES_VERSION_CONFLICT';
 END IF;
 -- Lock execution rows and reject stale progress as well as stale document data.
 PERFORM 1 FROM public.minutes_decisions WHERE minute_id=p_minute_id ORDER BY id FOR UPDATE;
 FOR v_state IN SELECT value FROM jsonb_array_elements(p_decision_states) LOOP
   IF EXISTS(SELECT 1 FROM public.minutes_decisions d WHERE d.id=(v_state->>'id')::uuid
     AND d.minute_id=p_minute_id AND (nullif(v_state->>'expected_updated_at','')::timestamptz IS NULL
       OR d.updated_at IS DISTINCT FROM nullif(v_state->>'expected_updated_at','')::timestamptz)) THEN
     RAISE EXCEPTION 'DECISION_VERSION_CONFLICT';
   END IF;
 END LOOP;
 v_before := private.admin_minutes_snapshot(p_minute_id);
 -- Reuse the validated, ID-preserving draft writer within this locked transaction.
 -- The draft state is never visible outside the transaction; any failure rolls back.
 UPDATE public.minutes SET status='draft' WHERE id=p_minute_id RETURNING updated_at INTO v_updated;
 v_result := private.update_minutes_draft(p_minute_id, v_updated, p_payload, p_decisions,
   p_deleted_decision_ids, p_deleted_external_participant_ids);
 IF (v_result->>'success')::boolean IS DISTINCT FROM true THEN
   RAISE EXCEPTION '%', coalesce(v_result->>'error_code','INTERNAL_ERROR');
 END IF;
 SELECT coalesce(array_agg(value::uuid), '{}') INTO v_internal
   FROM jsonb_array_elements_text(coalesce(p_signatories->'internal','[]'));
 SELECT coalesce(array_agg(value::uuid), '{}') INTO v_external
   FROM jsonb_array_elements_text(coalesce(p_signatories->'external','[]'));
 v_result := private.sync_minutes_signatories(p_minute_id, v_internal, v_external);
 IF (v_result->>'success')::boolean IS DISTINCT FROM true THEN
   RAISE EXCEPTION '%', coalesce(v_result->>'error_code','INTERNAL_ERROR');
 END IF;
 -- Existing signatures remain historical facts; never approve on another user's behalf.
 UPDATE public.minutes_approvals SET status='invalidated'
 WHERE minute_id=p_minute_id AND revision_number=m.revision_number
   AND (NOT (approver_user_id=ANY(v_internal)) OR p_payload->>'approval_mode' IS DISTINCT FROM 'system');
 IF p_payload->>'approval_mode'='system' THEN
   UPDATE public.minutes_approvals SET status='pending',approved_at=NULL,changes_requested_at=NULL,acted_by_user_id=NULL
   WHERE minute_id=p_minute_id AND revision_number=m.revision_number AND approver_user_id=ANY(v_internal)
      AND (status='invalidated' OR (p_status='pending_approval' AND p_status<>m.status));
   INSERT INTO public.minutes_approvals(minute_id,revision_number,approver_user_id,status)
   SELECT p_minute_id,m.revision_number,x,'pending' FROM unnest(v_internal) AS x
   WHERE NOT EXISTS (SELECT 1 FROM public.minutes_approvals a WHERE a.minute_id=p_minute_id
      AND a.revision_number=m.revision_number AND a.approver_user_id=x);
 END IF;
 FOR v_state IN SELECT value FROM jsonb_array_elements(p_decision_states) LOOP
   v_status := v_state->>'status'; v_progress := (v_state->>'progress_percent')::integer;
   IF v_status IS NULL OR v_status NOT IN ('not_started','planned','in_progress','waiting_coordination','waiting_approval','completed','stopped') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
   IF v_progress IS NULL OR v_progress NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'INVALID_PROGRESS'; END IF;
   IF v_status='completed' AND v_progress<>100 THEN RAISE EXCEPTION 'COMPLETION_REQUIRES_100_PERCENT'; END IF;
   -- Parent progress/status are derived from their clauses by the existing trigger.
   IF EXISTS(SELECT 1 FROM public.minutes_decisions c WHERE c.parent_decision_id=(v_state->>'id')::uuid) THEN CONTINUE; END IF;
   UPDATE public.minutes_decisions SET status=v_status,progress_percent=v_progress,
      completed_at=CASE WHEN v_status='completed' THEN coalesce(completed_at,now()) ELSE NULL END,
      updated_at=now()
    WHERE id=(v_state->>'id')::uuid AND minute_id=p_minute_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'DECISION_NOT_FOUND'; END IF;
 END LOOP;
 IF p_payload ? 'admin_finalization' AND jsonb_typeof(p_payload->'admin_finalization') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'PAYLOAD_INVALID'; END IF;
 UPDATE public.minutes SET status=p_status,
   admin_finalization=coalesce(p_payload->'admin_finalization',admin_finalization),
   admin_published_at=CASE WHEN p_status='published' THEN now() ELSE NULL END,
   admin_published_by_user_id=CASE WHEN p_status='published' THEN auth.uid() ELSE NULL END,
   submitted_at=CASE WHEN p_status IN ('draft','changes_requested') AND p_status<>m.status THEN NULL
                     WHEN p_status='pending_approval' THEN coalesce(m.submitted_at,now()) ELSE m.submitted_at END,
   secretary_confirmed_at=CASE WHEN p_status<>m.status AND p_status IN ('draft','changes_requested','pending_approval') THEN NULL ELSE m.secretary_confirmed_at END,
   secretary_confirmed_by_user_id=CASE WHEN p_status<>m.status AND p_status IN ('draft','changes_requested','pending_approval') THEN NULL ELSE m.secretary_confirmed_by_user_id END,
   chair_confirmed_at=CASE WHEN p_status<>m.status AND p_status IN ('draft','changes_requested','pending_approval') THEN NULL ELSE m.chair_confirmed_at END,
   chair_confirmed_by_user_id=CASE WHEN p_status<>m.status AND p_status IN ('draft','changes_requested','pending_approval') THEN NULL ELSE m.chair_confirmed_by_user_id END,
   published_at=CASE WHEN p_status='published' THEN coalesce(m.published_at,now()) ELSE NULL END,
   published_by_user_id=CASE WHEN p_status='published' THEN coalesce(m.published_by_user_id,auth.uid()) ELSE NULL END
 WHERE id=p_minute_id RETURNING updated_at INTO v_updated;
 v_after := private.admin_minutes_snapshot(p_minute_id);
 PERFORM public._write_minutes_audit(p_minute_id,'admin_correction','minute',p_minute_id,m.revision_number,
    v_before,v_after,jsonb_build_object('reason',btrim(p_reason),'administrative_override',true));
 RETURN jsonb_build_object('success',true,'minute_id',p_minute_id,'updated_at',v_updated);
EXCEPTION WHEN OTHERS THEN
 RETURN jsonb_build_object('success',false,'error_code',SQLERRM);
END;
$fn$;
REVOKE ALL ON FUNCTION private.admin_correct_minutes(uuid,timestamptz,jsonb,jsonb,uuid[],uuid[],text,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.admin_correct_minutes(uuid,timestamptz,jsonb,jsonb,uuid[],uuid[],text,text,jsonb,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_correct_minutes(
 p_minute_id uuid, p_expected_updated_at timestamptz, p_payload jsonb,
 p_decisions jsonb, p_deleted_decision_ids uuid[], p_deleted_external_participant_ids uuid[],
 p_status text, p_reason text, p_signatories jsonb, p_decision_states jsonb
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.admin_correct_minutes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
$fn$;
REVOKE ALL ON FUNCTION public.admin_correct_minutes(uuid,timestamptz,jsonb,jsonb,uuid[],uuid[],text,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_minutes(uuid,timestamptz,jsonb,jsonb,uuid[],uuid[],text,text,jsonb,jsonb) TO authenticated;

-- Repair the loader only if its existing non-admin restriction needs changing.
-- Match whitespace/case, rather than assuming one pg_get_functiondef rendering.
DO $migration$
DECLARE v_def text; v_patched text;
BEGIN
 SELECT pg_get_functiondef('private.get_minutes_decisions_for_edit(uuid)'::regprocedure) INTO v_def;
 IF strpos(v_def, 'admin_minutes_loader_compat_v1')=0
    AND strpos(v_def, 'and not (public.is_current_user_admin() and public.get_my_auth_access_state()')=0 THEN
   v_patched := regexp_replace(v_def,
     $pattern$if\s+v_minute_status\s+not\s+in\s*\(\s*'draft'\s*,\s*'changes_requested'\s*\)\s+then$pattern$,
     $replacement$if v_minute_status not in ('draft','changes_requested') and not (public.is_current_user_admin() and public.get_my_auth_access_state()->>'access_level'='FULL') then /* admin_minutes_loader_compat_v1 */$replacement$,
     'i');
   IF v_patched=v_def THEN RAISE EXCEPTION 'Unsupported decisions loader; no changes applied'; END IF;
   EXECUTE v_patched;
 END IF;
END;
$migration$;

-- Complete definition verified against the actual production function provided
-- by the operator. CREATE OR REPLACE retains ownership and existing ACLs.
CREATE OR REPLACE FUNCTION private.delete_minutes_attachment(p_attachment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
 v_minute_id uuid; v_filename text; v_attachment_kind text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT minute_id,original_filename,attachment_kind::text INTO v_minute_id,v_filename,v_attachment_kind
 FROM public.minutes_attachments WHERE id=p_attachment_id AND deleted_at IS NULL;
 IF v_minute_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF v_attachment_kind='signed_final' THEN
   IF NOT (public.is_current_user_admin() AND public.get_my_auth_access_state()->>'access_level'='FULL')
      AND NOT EXISTS (SELECT 1 FROM public.minutes m WHERE m.id=v_minute_id AND m.secretary_user_id=auth.uid()) THEN
     RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='42501';
   END IF;
 ELSIF NOT public._user_can_manage_minute_content(v_minute_id) THEN
   RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;
 UPDATE public.minutes_attachments SET deleted_at=now() WHERE id=p_attachment_id;
 PERFORM public._write_minutes_audit(v_minute_id,'attachment_deleted','attachment',p_attachment_id,
   NULL,jsonb_build_object('filename',v_filename),NULL,NULL);
END;
$function$;
NOTIFY pgrst,'reload schema';
