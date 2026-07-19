/*
# Minutes Phase 3 — corrective: storage policies + orphan cleanup

The minutes-attachments bucket had NO storage.objects policies, so uploads
via the anon-key client were RLS-denied. Add policies that delegate
authorization to the existing minutes helpers by extracting the minute_id
from the 2nd path segment (minutes/{minute_id}/...).
*/

-- ── Storage policies ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "minutes_attachments_upload" ON storage.objects;
CREATE POLICY "minutes_attachments_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'minutes-attachments'
    AND public._user_can_manage_minute_content((string_to_array(name, '/'))[2]::uuid)
  );

DROP POLICY IF EXISTS "minutes_attachments_read" ON storage.objects;
CREATE POLICY "minutes_attachments_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'minutes-attachments'
    AND public._user_can_view_minute((string_to_array(name, '/'))[2]::uuid)
  );

DROP POLICY IF EXISTS "minutes_attachments_delete" ON storage.objects;
CREATE POLICY "minutes_attachments_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'minutes-attachments'
    AND public._user_can_manage_minute_content((string_to_array(name, '/'))[2]::uuid)
  );

-- ── delete_minutes_attachment: also hard-remove storage object ───────────────
CREATE OR REPLACE FUNCTION public.delete_minutes_attachment(
  p_attachment_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_minute_id uuid;
  v_filename text;
  v_storage_path text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT minute_id, original_filename, storage_path INTO v_minute_id, v_filename, v_storage_path
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

  BEGIN
    DELETE FROM storage.objects
    WHERE bucket_id = 'minutes-attachments' AND name = v_storage_path;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM public._write_minutes_audit(
    v_minute_id, 'attachment_deleted', 'attachment', p_attachment_id,
    NULL, jsonb_build_object('filename', v_filename), NULL, NULL
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.delete_minutes_attachment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_minutes_attachment(uuid) TO authenticated;
ALTER FUNCTION public.delete_minutes_attachment(uuid) OWNER TO postgres;

-- ── Admin orphan cleanup RPC ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_orphan_minutes_attachments()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_deleted int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  DELETE FROM storage.objects o
  WHERE o.bucket_id = 'minutes-attachments'
    AND NOT EXISTS (
      SELECT 1 FROM public.minutes_attachments a
      WHERE a.storage_path = o.name AND a.deleted_at IS NULL
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('deleted_count', v_deleted);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.cleanup_orphan_minutes_attachments() FROM anon;
GRANT EXECUTE ON FUNCTION public.cleanup_orphan_minutes_attachments() TO authenticated;
ALTER FUNCTION public.cleanup_orphan_minutes_attachments() OWNER TO postgres;
