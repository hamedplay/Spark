CREATE OR REPLACE FUNCTION private.get_security_audit_page_v2(p_category text DEFAULT NULL::text, p_severity text DEFAULT NULL::text, p_result text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_actor_user_id uuid DEFAULT NULL::uuid, p_target_user_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rows jsonb;
  v_total bigint;
  v_limit integer := coalesce(p_limit,50);
  v_more boolean;
  v_cursor jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','UNAUTHORIZED'); END IF;
  IF NOT coalesce(private.is_current_session_fully_authorized(),false) THEN
    RETURN jsonb_build_object('ok',false,'error','AUTH_ACCESS_RESTRICTED');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=v_uid
    AND is_active IS TRUE AND account_status='ACTIVE'
    AND (is_admin IS TRUE OR is_security_admin IS TRUE)) THEN
    RETURN jsonb_build_object('ok',false,'error','FORBIDDEN');
  END IF;
  IF v_limit<1 OR v_limit>200 THEN RETURN jsonb_build_object('ok',false,'error','INVALID_LIMIT'); END IF;
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_CURSOR');
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_DATE_RANGE');
  END IF;
  WITH filtered AS MATERIALIZED (
    SELECT e.* FROM public.security_audit_events e
    WHERE (p_category IS NULL OR e.event_category=p_category)
      AND (p_severity IS NULL OR e.severity=p_severity)
      AND (p_result IS NULL OR e.result=p_result)
      AND (p_event_type IS NULL OR e.event_type=p_event_type)
      AND (p_actor_user_id IS NULL OR e.actor_user_id=p_actor_user_id)
      AND (p_target_user_id IS NULL OR e.target_user_id=p_target_user_id)
      AND (p_from IS NULL OR e.created_at>=p_from)
      AND (p_to IS NULL OR e.created_at<=p_to)
      AND (p_request_id IS NULL OR e.request_id=p_request_id)
  ), page_plus_one AS MATERIALIZED (
    SELECT * FROM filtered
    WHERE p_before_created_at IS NULL OR (created_at,id)<(p_before_created_at,p_before_id)
    ORDER BY created_at DESC,id DESC LIMIT v_limit+1
  ), visible_page AS (
    SELECT * FROM page_plus_one ORDER BY created_at DESC,id DESC LIMIT v_limit
  )
  SELECT coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',e.id,'created_at',e.created_at,'event_type',e.event_type,
    'event_category',e.event_category,'severity',e.severity,'result',e.result,
    'error_code',e.error_code,'actor_user_id',e.actor_user_id,
    'target_user_id',e.target_user_id,'session_id',e.session_id,
    'request_id',e.request_id,'metadata',public.sanitize_audit_metadata(e.metadata)
  ) ORDER BY e.created_at DESC,e.id DESC) FROM visible_page e),'[]'::jsonb),
    (SELECT count(*) FROM filtered),(SELECT count(*)>v_limit FROM page_plus_one)
  INTO v_rows,v_total,v_more;
  IF v_more AND jsonb_array_length(v_rows)>0 THEN
    v_cursor:=jsonb_build_object('before_created_at',v_rows->-1->>'created_at','before_id',v_rows->-1->>'id');
  END IF;
  RETURN jsonb_build_object('ok',true,'events',v_rows,'total',v_total,'has_more',v_more,'next_cursor',v_cursor);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_security_audit_page_v2(text,text,text,text,uuid,uuid,timestamptz,timestamptz,integer,timestamptz,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_security_audit_page_v2(text,text,text,text,uuid,uuid,timestamptz,timestamptz,integer,timestamptz,uuid,uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
