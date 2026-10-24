-- Preserve installed business logic and patch only the actor authorization.
-- Supports both the original public definer and the restored private implementation.
-- Abort on an unfamiliar definition rather than replace production-specific checks.
DO $migration$
DECLARE
  v_public oid := to_regprocedure('public.add_meeting_participant_as_informee(uuid,uuid)');
  v_impl oid;
  v_definition text;
  v_updated text;
  v_is_public boolean;
BEGIN
  IF v_public IS NULL THEN RAISE EXCEPTION 'Missing participant RPC'; END IF;
  SELECT prosecdef INTO v_is_public FROM pg_proc WHERE oid = v_public;
  v_impl := CASE WHEN v_is_public THEN v_public
    ELSE to_regprocedure('private.add_meeting_participant_as_informee(uuid,uuid)') END;
  IF v_impl IS NULL THEN RAISE EXCEPTION 'Missing participant implementation'; END IF;
  SELECT pg_get_functiondef(v_impl) INTO v_definition;
  v_updated := replace(v_definition,
    'IF NOT (v_caller = ANY(v_notify_users)) THEN',
    'IF NOT (v_caller = v_organizer OR v_caller = ANY(v_notify_users)) THEN');
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'Unsupported participant authorization; inspect installed definition';
  END IF;
  -- Definer code must enforce the same FULL-session gate as the table RLS.
  IF position('private.is_current_session_fully_authorized()' IN v_updated) = 0 THEN
    IF position('IF v_caller IS NULL THEN' IN v_updated) = 0 THEN
      RAISE EXCEPTION 'Unsupported participant session gate';
    END IF;
    v_updated := replace(v_updated, 'IF v_caller IS NULL THEN',
      'IF v_caller IS NULL OR NOT COALESCE(private.is_current_session_fully_authorized(), false) THEN');
  END IF;
  v_updated := replace(v_updated, '''source'',''notify_user''',
    '''source'',CASE WHEN v_caller = v_organizer THEN ''organizer'' ELSE ''notify_user'' END');
  IF v_is_public THEN
    IF to_regprocedure('private.add_meeting_participant_as_informee(uuid,uuid)') IS NOT NULL THEN
      RAISE EXCEPTION 'Ambiguous public/private participant implementation';
    END IF;
    v_updated := replace(v_updated,
      'FUNCTION public.add_meeting_participant_as_informee(',
      'FUNCTION private.add_meeting_participant_as_informee(');
  END IF;
  EXECUTE v_updated;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.add_meeting_participant_as_informee(
  p_meeting_id uuid, p_participant_user_id uuid
)
RETURNS TABLE(added boolean, participant_user_id uuid)
LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT * FROM private.add_meeting_participant_as_informee(p_meeting_id, p_participant_user_id);
$function$;

REVOKE ALL ON FUNCTION private.add_meeting_participant_as_informee(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_meeting_participant_as_informee(uuid,uuid) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.add_meeting_participant_as_informee(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_meeting_participant_as_informee(uuid,uuid) TO authenticated, service_role;
