-- The cron must use the same deployed sender as ordinary SMS.
-- Normalize existing legacy endpoints in memory; do not expose or rotate secrets.
CREATE OR REPLACE FUNCTION private.configure_meeting_notification_worker(p_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid; v_url text:=rtrim(btrim(p_url),'/'); v_token text;
BEGIN
 v_url:=regexp_replace(v_url,'/functions/v1/meeting-notification-worker$','/functions/v1/send-sms');
 IF v_url IS NULL OR v_url !~ '^https://[^/?#@[:space:]]+/functions/v1/send-sms$' THEN
  RAISE EXCEPTION 'INVALID_MEETING_WORKER_URL';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('spark.meeting-worker-config',0));
 v_token:=private.safe_vault_secret('meeting_notification_worker_token');
 IF COALESCE(length(v_token),0)<32 THEN
  SELECT id INTO v_id FROM vault.secrets WHERE name='meeting_notification_worker_token';
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  IF v_id IS NULL THEN PERFORM vault.create_secret(v_token,'meeting_notification_worker_token');
  ELSE PERFORM vault.update_secret(v_id,v_token); END IF;
 END IF;
 SELECT id INTO v_id FROM vault.secrets WHERE name='meeting_notification_worker_url';
 IF v_id IS NULL THEN PERFORM vault.create_secret(v_url,'meeting_notification_worker_url');
 ELSE PERFORM vault.update_secret(v_id,v_url); END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.run_meeting_notification_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_url text; v_token text; v_reminders integer;
BEGIN
  -- A missing SMS worker must not roll back successfully materialized in-app reminders.
  v_reminders:=private.materialize_series_reminders();
  DELETE FROM private.meeting_notification_jobs j WHERE j.status IN('sent','skipped','failed')
    AND j.created_at<now()-interval '90 days'
    AND NOT EXISTS(SELECT FROM jsonb_array_elements(j.meetings)e
      WHERE private.meeting_local_date(e->>'request_date')>=(now() AT TIME ZONE 'Asia/Tehran')::date);
  UPDATE private.meeting_scheduler_state SET last_tick_at=clock_timestamp(),
    last_reminder_count=v_reminders,dispatch_status='idle',last_error=NULL WHERE singleton;
  IF NOT EXISTS(SELECT FROM private.meeting_notification_jobs WHERE status IN('pending','processing')) THEN RETURN; END IF;
  v_url:=rtrim(private.safe_vault_secret('meeting_notification_worker_url'),'/');
  v_url:=regexp_replace(v_url,'/functions/v1/meeting-notification-worker$','/functions/v1/send-sms');
  v_token:=private.safe_vault_secret('meeting_notification_worker_token');
  IF nullif(v_url,'') IS NULL OR nullif(v_token,'') IS NULL THEN
    IF EXISTS(SELECT FROM private.meeting_scheduler_state WHERE singleton AND last_background_delivery_at>now()-interval '3 minutes') THEN
      UPDATE private.meeting_scheduler_state SET dispatch_status='existing_sender_active',last_error=NULL WHERE singleton;
      RETURN;
    END IF;
    UPDATE private.meeting_scheduler_state SET dispatch_status='blocked',last_error='MEETING_WORKER_NOT_CONFIGURED' WHERE singleton;
    RETURN;
  END IF;
  IF v_url !~ '^https://[^/?#@[:space:]]+/functions/v1/send-sms$' THEN
    UPDATE private.meeting_scheduler_state SET dispatch_status='blocked',last_error='MEETING_WORKER_URL_INVALID' WHERE singleton;
    RETURN;
  END IF;
  BEGIN
    PERFORM net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json',
      'X-Meeting-Worker-Token',v_token),body:='{"mode":"recurring_delivery"}'::jsonb,timeout_milliseconds:=55000);
    UPDATE private.meeting_scheduler_state SET dispatch_status='requested' WHERE singleton;
  EXCEPTION WHEN OTHERS THEN
    UPDATE private.meeting_scheduler_state SET dispatch_status='error',last_error='WORKER_DISPATCH_FAILED:'||SQLSTATE WHERE singleton;
  END;
END $function$;

NOTIFY pgrst,'reload schema';
