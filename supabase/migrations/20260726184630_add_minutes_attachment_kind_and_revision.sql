/*
# Add attachment_kind and revision_number to minutes_attachments

1. New Columns
- `minutes_attachments.attachment_kind` (text, NOT NULL, default 'general')
  - Distinguishes ordinary attachments ('general') from the signed final
    PDF/image of the minutes ('signed_final').
  - CHECK constraint limits values to 'general' or 'signed_final'.
- `minutes_attachments.revision_number` (integer, NULLABLE)
  - For signed_final attachments, records which revision of the minute
    the file corresponds to. NULL for general attachments.

2. Modified Functions
- `begin_minutes_attachment_upload`: new optional parameter
  `p_attachment_kind TEXT DEFAULT 'general'`. Validates the value is
  one of 'general' or 'signed_final' (raises INVALID_KIND otherwise).
  The value is stored on the inserted row. Backward compatible —
  existing callers that omit the parameter get 'general'.
- `create_minutes_attachment_record`: same new optional parameter with
  the same validation, for parity with the legacy insert path.

3. Security
- No RLS policy changes. Existing policies already gate writes through
  `_user_can_manage_minute_content` (creator/secretary/chair/admin) and
  reads through `_user_can_view_minute`. The kind is validated
  server-side in the SECURITY DEFINER RPC, so users cannot inject
  arbitrary values.
- No new buckets. Files use the existing private 'minutes-attachments'
  bucket and existing signed-URL download path.

4. Backward Compatibility
- All existing rows get attachment_kind = 'general' (the column default).
- revision_number stays NULL for all existing rows.
- The migration is fully additive — no columns dropped, no types
  changed, no data rewritten beyond the default backfill.

5. Index
- Partial index on (minute_id, revision_number) WHERE
  attachment_kind = 'signed_final' AND deleted_at IS NULL, so the
  "latest signed final for this minute" query is fast.
*/

-- ── Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.minutes_attachments
  ADD COLUMN IF NOT EXISTS attachment_kind text NOT NULL DEFAULT 'general';

ALTER TABLE public.minutes_attachments
  ADD COLUMN IF NOT EXISTS revision_number integer;

-- ── Check constraint (idempotent) ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'minutes_attachments_attachment_kind_check'
  ) THEN
    ALTER TABLE public.minutes_attachments
      ADD CONSTRAINT minutes_attachments_attachment_kind_check
      CHECK (attachment_kind IN ('general', 'signed_final'));
  END IF;
END $$;

-- ── Partial index for latest signed-final lookup ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_minutes_attachments_signed_final
  ON public.minutes_attachments (minute_id, revision_number DESC, created_at DESC)
  WHERE attachment_kind = 'signed_final' AND deleted_at IS NULL;

-- ── begin_minutes_attachment_upload (add kind param) ─────────────────────
CREATE OR REPLACE FUNCTION public.begin_minutes_attachment_upload(
  p_minute_id uuid,
  p_agenda_result_id uuid,
  p_decision_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_description text,
  p_attachment_kind text DEFAULT 'general'
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

  -- Validate attachment kind (server-side; users cannot inject arbitrary values)
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
    uploaded_by_user_id, description, upload_status, attachment_kind
  ) VALUES (
    v_id, p_minute_id, p_agenda_result_id, p_decision_id, v_storage_path,
    p_original_filename, v_sanitized, p_mime_type, p_size_bytes,
    auth.uid(), p_description, 'pending_upload', v_kind
  );

  RETURN jsonb_build_object('attachment_id', v_id, 'storage_path', v_storage_path);
END;
$function$;

-- ── create_minutes_attachment_record (add kind param, parity) ────────────
CREATE OR REPLACE FUNCTION public.create_minutes_attachment_record(
  p_minute_id uuid,
  p_agenda_result_id uuid,
  p_decision_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_stored_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_description text,
  p_attachment_kind text DEFAULT 'general'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_id uuid;
  v_status text;
  v_kind text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT public._user_can_manage_minute_content(p_minute_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF btrim(p_original_filename) = '' OR p_storage_path IS NULL OR p_stored_filename IS NULL THEN
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

  INSERT INTO public.minutes_attachments (
    minute_id, agenda_result_id, decision_id, storage_path,
    original_filename, stored_filename, mime_type, size_bytes,
    uploaded_by_user_id, description, attachment_kind
  ) VALUES (
    p_minute_id, p_agenda_result_id, p_decision_id, p_storage_path,
    p_original_filename, p_stored_filename, p_mime_type, p_size_bytes,
    auth.uid(), p_description, v_kind
  ) RETURNING id INTO v_id;

  PERFORM public._write_minutes_audit(
    p_minute_id, 'attachment_uploaded', 'attachment', v_id,
    NULL, NULL,
    jsonb_build_object('filename', p_original_filename, 'size', p_size_bytes, 'mime', p_mime_type, 'kind', v_kind),
    NULL
  );

  RETURN v_id;
END;
$function$;

-- ── get_latest_signed_final_attachment RPC ────────────────────────────────
-- Returns the most recent signed_final attachment row for a minute.
CREATE OR REPLACE FUNCTION public.get_latest_signed_final_attachment(
  p_minute_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT public._user_can_view_minute(p_minute_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(t) INTO v_row
  FROM (
    SELECT id, minute_id, storage_path, original_filename, stored_filename,
           mime_type, size_bytes, uploaded_by_user_id, description,
           created_at, revision_number
    FROM public.minutes_attachments
    WHERE minute_id = p_minute_id
      AND attachment_kind = 'signed_final'
      AND deleted_at IS NULL
      AND upload_status = 'ready'
    ORDER BY revision_number DESC NULLS LAST, created_at DESC
    LIMIT 1
  ) t;

  RETURN COALESCE(v_row, 'null'::jsonb);
END;
$function$;
