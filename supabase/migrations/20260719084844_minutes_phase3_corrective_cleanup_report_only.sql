/*
# Minutes Phase 3 — corrective: orphan cleanup RPC is report-only

Supabase's storage.protect_delete trigger blocks ALL direct DELETEs on
storage.objects, even from SECURITY DEFINER functions. The cleanup RPC
cannot remove orphan objects via SQL. Fix: make the RPC report-only (lists
orphan paths); actual removal must happen via the Storage API (HTTP) in the
frontend, which the delete flow already does.
*/

CREATE OR REPLACE FUNCTION public.cleanup_orphan_minutes_attachments()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_orphans jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', o.name)), '[]'::jsonb)
  INTO v_orphans
  FROM storage.objects o
  WHERE o.bucket_id = 'minutes-attachments'
    AND NOT EXISTS (
      SELECT 1 FROM public.minutes_attachments a
      WHERE a.storage_path = o.name AND a.deleted_at IS NULL
    );

  RETURN jsonb_build_object('orphans', v_orphans, 'count', jsonb_array_length(v_orphans));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.cleanup_orphan_minutes_attachments() FROM anon;
GRANT EXECUTE ON FUNCTION public.cleanup_orphan_minutes_attachments() TO authenticated;
ALTER FUNCTION public.cleanup_orphan_minutes_attachments() OWNER TO postgres;
