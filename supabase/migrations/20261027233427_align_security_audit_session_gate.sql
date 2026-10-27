-- v3 also checks temporary account locks. Keep the existing pagination, filters
-- and ACLs unchanged; fail rather than replace an unexpected function body.
DO $migration$
DECLARE
  v_oid regprocedure := 'private.get_security_audit_page_v2(text,text,text,text,uuid,uuid,timestamptz,timestamptz,integer,timestamptz,uuid,uuid)'::regprocedure;
  v_definition text;
  v_old text := 'IF NOT coalesce(private.is_current_session_fully_authorized(),false) THEN';
  v_new text := 'IF (private.get_my_auth_access_state_v3()->>''access_level'') IS DISTINCT FROM ''FULL'' THEN';
BEGIN
  v_definition:=pg_get_functiondef(v_oid);
  IF strpos(v_definition,v_new)>0 THEN RETURN; END IF;
  IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'UNEXPECTED_SECURITY_AUDIT_GATE'; END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END $migration$;
NOTIFY pgrst,'reload schema';
