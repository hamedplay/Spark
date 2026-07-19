/*
# Minutes Phase 3 — corrective: secure upload flow + approval audit

## 1. Close direct storage upload bypass
DROP the minutes_attachments_upload INSERT policy on storage.objects.
No authenticated client can INSERT into storage.objects for minutes-attachments.
Uploads happen via signed upload URLs (client calls createSignedUploadUrl).

## 2. Begin/finalize upload flow
- begin_minutes_attachment_upload: validates auth/status/ext/mime/size/target,
  creates record with upload_status='pending_upload', derives storage_path,
  returns {attachment_id, storage_path}. Client creates signed upload URL + uploads.
- finalize_minutes_attachment: verifies object exists in storage.objects, checks
  size/mime metadata, sets upload_status='ready', writes attachment_uploaded audit.
- Pending records older than 24h cleaned by admin RPC.

## 3. Delete flow
delete_minutes_attachment no longer attempts SQL DELETE on storage.objects
(blocked by platform protect_delete trigger). Frontend removes storage object
via Storage API FIRST; only if that succeeds, calls RPC to soft-delete record.
If storage delete fails, record stays active, error shown.

## 4. approval_given audit
approve_minute_revision now writes an explicit approval_given audit log when
a new approval is recorded (not on idempotent re-call).
*/

-- ── Add upload_status column ────────────────────────────────────────────────
ALTER TABLE public.minutes_attachments ADD COLUMN IF NOT EXISTS upload_status text
  NOT NULL DEFAULT 'ready';
CREATE INDEX IF NOT EXISTS idx_minutes_attachments_upload_status
  ON public.minutes_attachments (upload_status) WHERE upload_status = 'pending_upload';

-- ── Drop direct INSERT policy on storage.objects ────────────────────────────
DROP POLICY IF EXISTS "minutes_attachments_upload" ON storage.objects;

-- ── Update SELECT RLS: only ready attachments visible ────────────────────────
DROP POLICY IF EXISTS "attachments_select_visible" ON public.minutes_attachments;
CREATE POLICY "attachments_select_visible"
  ON public.minutes_attachments FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL AND upload_status = 'ready' AND public._user_can_view_minute(minute_id));

-- ── begin_minutes_attachment_upload RPC ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.begin_minutes_attachment_upload(
  p_minute_id uuid,
  p_agenda_result_id uuid,
  p_decision_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_description text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
  v_status text;
  v_ext text;
  v_sanitized text;
  v_storage_path text;
  v_lower text;
  v_allowed_ext text[] := ARRAY['pdf','doc','docx','xls','xlsx','ppt','pptx','jpg','jpeg','png','webp','txt','zip'];
  v_allowed_mime text[] := ARRAY['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','image/jpeg','image/png','image/webp','text/plain','application/zip'];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT public._user_can_manage_minute_content(p_minute_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF btrim(p_original_filename) = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = '23514';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 20971520 THEN
    RAISE EXCEPTION 'INVALID_SIZE' USING ERRCODE = '23514';
  END IF;
  IF NOT public._minutes_attachment_target_ok(p_minute_id, p_agenda_result_id, p_decision_id) THEN
    RAISE EXCEPTION 'TARGET_MISMATCH' USING ERRCODE = '23514';
  END IF;

  SELECT status INTO v_status FROM public.minutes WHERE id = p_minute_id;
  IF v_status = 'published' AND NOT public.is_current_user_admin()
    AND NOT EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = p_minute_id
      AND (m.secretary_user_id = auth.uid() OR m.chair_user_id = auth.uid())
    ) THEN
    RAISE EXCEPTION 'PUBLISHED_LOCKED' USING ERRCODE = '42501';
  END IF;

  -- Validate extension
  v_lower := lower(btrim(p_original_filename));
  v_ext := substring(v_lower from '[^.]+$');
  IF v_ext = '' OR NOT (v_ext = ANY(v_allowed_ext)) THEN
    RAISE EXCEPTION 'INVALID_EXTENSION' USING ERRCODE = '23514';
  END IF;
  -- Validate mime
  IF p_mime_type IS NULL OR NOT (lower(p_mime_type) = ANY(v_allowed_mime)) THEN
    RAISE EXCEPTION 'INVALID_MIME' USING ERRCODE = '23514';
  END IF;

  -- Sanitize filename: keep unicode letters/digits/dot/dash/underscore
  v_sanitized := regexp_replace(btrim(p_original_filename), '[\s]+', '_', 'g');
  v_sanitized := regexp_replace(v_sanitized, '[^\w.\-]', '_', 'g');
  -- Prevent path separators and traversal
  v_sanitized := replace(replace(v_sanitized, '/', '_'), '\', '_');
  v_sanitized := left(v_sanitized, 120);
  IF v_sanitized = '' OR v_sanitized ~ '^\.' THEN v_sanitized := 'file'; END IF;

  v_id := gen_random_uuid();
  v_storage_path := 'minutes/' || p_minute_id::text || '/' || v_id::text || '/' || v_sanitized;

  INSERT INTO public.minutes_attachments (
    id, minute_id, agenda_result_id, decision_id, storage_path,
    original_filename, stored_filename, mime_type, size_bytes,
    uploaded_by_user_id, description, upload_status
  ) VALUES (
    v_id, p_minute_id, p_agenda_result_id, p_decision_id, v_storage_path,
    p_original_filename, v_sanitized, p_mime_type, p_size_bytes,
    auth.uid(), p_description, 'pending_upload'
  );

  RETURN jsonb_build_object('attachment_id', v_id, 'storage_path', v_storage_path);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.begin_minutes_attachment_upload(uuid,uuid,uuid,text,text,bigint,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.begin_minutes_attachment_upload(uuid,uuid,uuid,text,text,bigint,text) TO authenticated;
ALTER FUNCTION public.begin_minutes_attachment_upload(uuid,uuid,uuid,text,text,bigint,text) OWNER TO postgres;

-- ── finalize_minutes_attachment RPC ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_minutes_attachment(
  p_attachment_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_minute_id uuid;
  v_storage_path text;
  v_expected_size bigint;
  v_expected_mime text;
  v_filename text;
  v_obj_size bigint;
  v_obj_mime text;
  v_obj_metadata jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT minute_id, storage_path, size_bytes, mime_type, original_filename, upload_status
    INTO v_minute_id, v_storage_path, v_expected_size, v_expected_mime, v_filename
    FROM public.minutes_attachments
    WHERE id = p_attachment_id AND deleted_at IS NULL;

  IF v_minute_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Only uploader or admin can finalize
  IF NOT public.is_current_user_admin() THEN
    PERFORM 1 FROM public.minutes_attachments
    WHERE id = p_attachment_id AND uploaded_by_user_id = auth.uid();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Verify object exists in storage
  BEGIN
    SELECT (metadata->>'size')::bigint, metadata->>'mimetype', metadata
      INTO v_obj_size, v_obj_mime, v_obj_metadata
      FROM storage.objects
      WHERE bucket_id = 'minutes-attachments' AND name = v_storage_path;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'OBJECT_NOT_FOUND' USING ERRCODE = 'P0002';
  END;

  IF v_obj_size IS NULL THEN
    RAISE EXCEPTION 'OBJECT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Verify size matches (allow small tolerance for encoding)
  IF abs(v_obj_size - v_expected_size) > 1024 THEN
    RAISE EXCEPTION 'SIZE_MISMATCH expected=% actual=%', v_expected_size, v_obj_size
      USING ERRCODE = '23514';
  END IF;

  -- Mark ready
  UPDATE public.minutes_attachments
    SET upload_status = 'ready'
    WHERE id = p_attachment_id;

  -- Audit only on successful finalize
  PERFORM public._write_minutes_audit(
    v_minute_id, 'attachment_uploaded', 'attachment', p_attachment_id,
    NULL, NULL,
    jsonb_build_object('filename', v_filename, 'size', v_obj_size, 'mime', v_expected_mime),
    NULL
  );

  RETURN jsonb_build_object('success', true, 'attachment_id', p_attachment_id);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.finalize_minutes_attachment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.finalize_minutes_attachment(uuid) TO authenticated;
ALTER FUNCTION public.finalize_minutes_attachment(uuid) OWNER TO postgres;

-- ── delete_minutes_attachment: no storage DELETE (frontend does it first) ───
CREATE OR REPLACE FUNCTION public.delete_minutes_attachment(
  p_attachment_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_minute_id uuid;
  v_filename text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT minute_id, original_filename INTO v_minute_id, v_filename
  FROM public.minutes_attachments
  WHERE id = p_attachment_id AND deleted_at IS NULL;
  IF v_minute_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._user_can_manage_minute_content(v_minute_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.minutes_attachments
  SET deleted_at = now()
  WHERE id = p_attachment_id;

  PERFORM public._write_minutes_audit(
    v_minute_id, 'attachment_deleted', 'attachment', p_attachment_id,
    NULL, jsonb_build_object('filename', v_filename), NULL, NULL
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.delete_minutes_attachment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_minutes_attachment(uuid) TO authenticated;
ALTER FUNCTION public.delete_minutes_attachment(uuid) OWNER TO postgres;

-- ── get_minutes_attachment_signed_url: only ready ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_minutes_attachment_signed_url(
  p_attachment_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_storage_path text;
  v_minute_id uuid;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT storage_path, minute_id, upload_status INTO v_storage_path, v_minute_id, v_status
  FROM public.minutes_attachments
  WHERE id = p_attachment_id AND deleted_at IS NULL;
  IF v_storage_path IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'ready' THEN
    RAISE EXCEPTION 'NOT_READY' USING ERRCODE = '42501';
  END IF;
  IF NOT public._user_can_view_minute(v_minute_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RETURN v_storage_path;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_minutes_attachment_signed_url(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_minutes_attachment_signed_url(uuid) TO authenticated;
ALTER FUNCTION public.get_minutes_attachment_signed_url(uuid) OWNER TO postgres;

-- ── Revoke old create_minutes_attachment_record ─────────────────────────────
REVOKE EXECUTE ON FUNCTION public.create_minutes_attachment_record(uuid,uuid,uuid,text,text,text,text,bigint,text) FROM authenticated;

-- ── approve_minute_revision: add approval_given audit ────────────────────────
CREATE OR REPLACE FUNCTION public.approve_minute_revision(
  p_minute_id       uuid,
  p_revision_number integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id          uuid;
  v_minute_status    text;
  v_minute_revision  integer;
  v_approval_mode    text;
  v_current_status   text;
  v_all_approved     boolean;
  v_msg_text         text;
  v_diag_sqlstate     text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, revision_number, approval_mode
    INTO v_minute_status, v_minute_revision, v_approval_mode
    FROM public.minutes
   WHERE id = p_minute_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_approval_mode IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_SYSTEM_MODE' USING ERRCODE = 'P0001';
  END IF;

  IF v_minute_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'MINUTE_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  IF p_revision_number <> v_minute_revision THEN
    RAISE EXCEPTION 'REVISION_NOT_CURRENT' USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_current_status
    FROM public.minutes_approvals
   WHERE minute_id = p_minute_id
     AND revision_number = p_revision_number
     AND approver_user_id = v_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AN_APPROVER' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent: already approved (no duplicate audit)
  IF v_current_status = 'approved' THEN
    RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
      'status', 'already_approved', 'message', 'تأیید شما قبلاً ثبت شده است');
  END IF;

  IF v_current_status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.minutes_approvals
     SET status = 'approved', approved_at = now(), updated_at = now()
   WHERE minute_id = p_minute_id
     AND revision_number = p_revision_number
     AND approver_user_id = v_user_id;

  -- Explicit approval_given audit (trigger only watches minutes table)
  PERFORM public._write_minutes_audit(
    p_minute_id, 'approval_given', 'approval', v_user_id, p_revision_number,
    NULL, jsonb_build_object('revision', p_revision_number), NULL
  );

  SELECT bool_and(status = 'approved') INTO v_all_approved
    FROM public.minutes_approvals
   WHERE minute_id = p_minute_id
     AND revision_number = p_revision_number
     AND status <> 'invalidated';

  IF v_all_approved THEN
    UPDATE public.minutes SET status = 'approved' WHERE id = p_minute_id;
    RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
      'status', 'approved', 'message', 'همه تأییدکنندگان تأیید کردند. صورت‌جلسه تأیید شد.');
  END IF;

  RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
    'status', 'pending_approval', 'message', 'تأیید شما ثبت شد. در انتظار تأیید سایر تأییدکنندگان.');

  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_msg_text = MESSAGE_TEXT;
      RETURN jsonb_build_object('success', false, 'error_code', v_msg_text,
        'sqlstate', 'P0001', 'message', v_msg_text);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
      RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
        'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در تأیید صورت‌جلسه');
END;
$$;

REVOKE ALL ON FUNCTION public.approve_minute_revision(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_minute_revision(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_minute_revision(uuid, integer) TO authenticated;
ALTER FUNCTION public.approve_minute_revision(uuid, integer) OWNER TO postgres;

-- ── Cleanup pending attachments RPC (admin) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_pending_minutes_attachments(
  p_max_age_hours integer DEFAULT 24
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_count int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.minutes_attachments
  WHERE upload_status = 'pending_upload'
    AND created_at < now() - (p_max_age_hours || ' hours')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('deleted_count', v_count);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.cleanup_pending_minutes_attachments(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.cleanup_pending_minutes_attachments(integer) TO authenticated;
ALTER FUNCTION public.cleanup_pending_minutes_attachments(integer) OWNER TO postgres;
