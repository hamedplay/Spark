-- Extend only actor authorization; preserve installed validation and inbox logic.
DO $migration$
DECLARE
  v_public oid := to_regprocedure('public.add_meeting_participant_as_informee(uuid,uuid)');
  v_impl oid;
  v_is_public boolean;
  v_definition text;
  v_updated text;
BEGIN
  IF v_public IS NULL THEN RAISE EXCEPTION 'Missing participant RPC'; END IF;
  SELECT prosecdef INTO v_is_public FROM pg_proc WHERE oid = v_public;
  v_impl := CASE WHEN v_is_public THEN v_public
    ELSE to_regprocedure('private.add_meeting_participant_as_informee(uuid,uuid)') END;
  IF v_impl IS NULL THEN RAISE EXCEPTION 'Missing participant implementation'; END IF;
  SELECT pg_get_functiondef(v_impl) INTO v_definition;
  v_updated := replace(v_definition,
    'IF NOT (v_caller = v_organizer OR v_caller = ANY(v_notify_users)) THEN',
    'IF NOT (v_caller = v_organizer OR v_caller = ANY(v_notify_users) OR v_caller = ANY(v_participant_ids)) THEN');
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'Unsupported participant authorization; inspect installed definition';
  END IF;
  IF position('private.is_current_session_fully_authorized()' IN v_updated) = 0 THEN
    RAISE EXCEPTION 'Missing participant FULL-session gate';
  END IF;
  v_updated := replace(v_updated,
    '''source'',CASE WHEN v_caller = v_organizer THEN ''organizer'' ELSE ''notify_user'' END',
    '''source'',CASE WHEN v_caller = v_organizer THEN ''organizer'' WHEN v_caller = ANY(v_notify_users) THEN ''notify_user'' ELSE ''participant'' END');
  EXECUTE v_updated;
END;
$migration$;
