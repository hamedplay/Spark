/*
# Add revision_number parameter to begin_minutes_attachment_upload

1. Modified Functions
- `begin_minutes_attachment_upload`: new optional parameter
  `p_revision_number integer DEFAULT NULL`. When provided, stored on
  the inserted row so signed_final attachments are traceable to a
  specific minute revision. Backward compatible — existing callers
  that omit it get NULL (same as before).

2. Security
- No RLS changes. The revision_number is informational metadata; write
  access is still gated by `_user_can_manage_minute_content`.
*/

CREATE OR REPLACE FUNCTION public.begin_minutes_attachment_upload(
  p_minute_id uuid,
  p_agenda_result_id uuid,
  p_decision_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_description text,
  p_attachment_kind text DEFAULT 'general',
  p_revision_number integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_id uuid;
  v_status text;
  v_ext text;
  v_sanitized text;
  v_storage_path text;
  v_lower text;
  v_kind text;
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

  v_kind := COALESCE(lower(btrim(p_attachment_kind)), 'general');
  IF v_kind NOT IN ('general', 'signed_final') THEN
    RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE = '23514';
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

  v_lower := lower(btrim(p_original_filename));
  v_ext := substring(v_lower from '[^.]+$');
  IF v_ext = '' OR NOT (v_ext = ANY(v_allowed_ext)) THEN
    RAISE EXCEPTION 'INVALID_EXTENSION' USING ERRCODE = '23514';
  END IF;
  IF p_mime_type IS NULL OR NOT (lower(p_mime_type) = ANY(v_allowed_mime)) THEN
    RAISE EXCEPTION 'INVALID_MIME' USING ERRCODE = '23514';
  END IF;

  v_sanitized := regexp_replace(btrim(p_original_filename), '[\s]+', '_', 'g');
  v_sanitized := regexp_replace(v_sanitized, '[^\w.\-]', '_', 'g');
  v_sanitized := replace(replace(v_sanitized, '/', '_'), '\', '_');
  v_sanitized := left(v_sanitized, 120);
  IF v_sanitized = '' OR v_sanitized ~ '^\.' THEN v_sanitized := 'file'; END IF;

  v_id := gen_random_uuid();
  v_storage_path := 'minutes/' || p_minute_id::text || '/' || v_id::text || '/' || v_sanitized;

  INSERT INTO public.minutes_attachments (
    id, minute_id, agenda_result_id, decision_id, storage_path,
    original_filename, stored_filename, mime_type, size_bytes,
    uploaded_by_user_id, description, upload_status, attachment_kind, revision_number
  ) VALUES (
    v_id, p_minute_id, p_agenda_result_id, p_decision_id, v_storage_path,
    p_original_filename, v_sanitized, p_mime_type, p_size_bytes,
    auth.uid(), p_description, 'pending_upload', v_kind, p_revision_number
  );

  RETURN jsonb_build_object('attachment_id', v_id, 'storage_path', v_storage_path);
END;
$function$;
