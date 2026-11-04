ALTER TABLE private.note_reminder_worker_config ADD COLUMN last_request_id bigint, ADD COLUMN last_http_status integer;

CREATE OR REPLACE FUNCTION private.run_note_reminder_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE cfg private.note_reminder_worker_config; response record; v_request bigint;
BEGIN
 PERFORM private.process_due_note_reminders();
 SELECT * INTO cfg FROM private.note_reminder_worker_config WHERE singleton;
 -- pg_net dispatch is asynchronous: accepting a request is not delivery success.
 IF cfg.last_request_id IS NOT NULL THEN
   SELECT status_code,timed_out,error_msg INTO response FROM net._http_response WHERE id=cfg.last_request_id;
   IF FOUND THEN
     UPDATE private.note_reminder_worker_config SET last_http_status=response.status_code,
       last_error=CASE WHEN coalesce(response.timed_out,false) THEN 'WORKER_TIMEOUT'
         WHEN response.error_msg IS NOT NULL THEN 'WORKER_NETWORK_ERROR'
         WHEN response.status_code BETWEEN 200 AND 299 THEN NULL
         ELSE 'WORKER_HTTP_'||coalesce(response.status_code::text,'UNKNOWN') END WHERE singleton;
   END IF;
 END IF;
 UPDATE private.note_reminder_worker_config SET last_tick_at=now() WHERE singleton;
 IF NOT EXISTS(SELECT FROM private.note_reminder_deliveries WHERE (status IN('pending','failed') AND attempts<3 AND available_at<=now()) OR status='sending') THEN RETURN; END IF;
 IF cfg.worker_url IS NULL THEN UPDATE private.note_reminder_worker_config SET last_error='WORKER_NOT_CONFIGURED' WHERE singleton; RETURN; END IF;
 BEGIN
   SELECT net.http_post(url:=cfg.worker_url,headers:=jsonb_build_object('Content-Type','application/json','X-Note-Worker-Token',cfg.worker_token),body:='{}'::jsonb,timeout_milliseconds:=55000) INTO v_request;
   UPDATE private.note_reminder_worker_config SET last_request_id=v_request WHERE singleton;
 EXCEPTION WHEN OTHERS THEN UPDATE private.note_reminder_worker_config SET last_error='WORKER_DISPATCH_FAILED:'||SQLSTATE WHERE singleton;
 END;
END $f$;
REVOKE ALL ON FUNCTION private.run_note_reminder_tick() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_note_reminder_delivery_status(p_note_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE n public.notes; cfg private.note_reminder_worker_config; deliveries jsonb:='[]'; v_running boolean;
BEGIN
 IF auth.uid() IS NULL OR private.is_current_session_fully_authorized() IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED' USING ERRCODE='42501';
 END IF;
 IF p_note_id IS NOT NULL THEN
   SELECT * INTO n FROM public.notes WHERE id=p_note_id AND user_id=auth.uid();
   IF NOT FOUND THEN RAISE EXCEPTION 'NOTE_NOT_FOUND' USING ERRCODE='42501'; END IF;
   SELECT coalesce(jsonb_agg(jsonb_build_object('recipient_id',recipient_id,'channel',channel,'status',status,'reason',reason) ORDER BY recipient_id,channel),'[]') INTO deliveries
   FROM (
    SELECT recipient_id,channel,
     CASE WHEN bool_or(status='uncertain') THEN 'uncertain'
       WHEN bool_or(status='failed' AND attempts>=3) THEN 'failed'
       WHEN bool_or(status IN('pending','sending','failed')) THEN 'pending'
       WHEN bool_and(status='sent') THEN 'sent'
       WHEN bool_or(status='cancelled') THEN 'cancelled' ELSE 'skipped' END AS status,
     max(last_error) FILTER(WHERE status<>'sent') AS reason
    FROM private.note_reminder_deliveries WHERE note_id=n.id AND remind_at=n.remind_at GROUP BY recipient_id,channel
   ) grouped;
 END IF;
 SELECT * INTO cfg FROM private.note_reminder_worker_config WHERE singleton;
 SELECT EXISTS(SELECT FROM cron.job WHERE jobname='spark-note-reminders' AND active AND command LIKE '%run_note_reminder_tick%') INTO v_running;
 RETURN jsonb_build_object(
  'ready',coalesce(cfg.worker_url IS NOT NULL AND cfg.last_tick_at>now()-interval '3 minutes' AND cfg.last_error IS NULL AND v_running,false),
  'last_error',CASE WHEN cfg.worker_url IS NULL THEN 'WORKER_NOT_CONFIGURED' WHEN NOT v_running THEN 'SCHEDULER_NOT_ACTIVE' ELSE cfg.last_error END,
  'legacy_in_app_only',p_note_id IS NOT NULL AND n.reminder_sent_at IS NOT NULL AND n.remind_at IS NOT NULL AND deliveries='[]'::jsonb,
  'deliveries',deliveries);
END $f$;
REVOKE ALL ON FUNCTION public.get_note_reminder_delivery_status(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_note_reminder_delivery_status(uuid) TO authenticated;

SELECT cron.schedule('spark-note-reminders','* * * * *','SELECT private.run_note_reminder_tick();');
NOTIFY pgrst,'reload schema';
