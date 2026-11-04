\set ON_ERROR_STOP on
\pset pager off
-- Read-only diagnostics. Never prints worker tokens, note text, phones or bot secrets.
SELECT to_regclass('private.note_reminder_deliveries') IS NOT NULL AS queue_present,
 to_regclass('private.note_reminder_worker_config') IS NOT NULL AS config_present,
 to_regprocedure('public.get_note_reminder_delivery_status(uuid)') IS NOT NULL AS diagnostics_rpc;
SELECT to_regclass('cron.job') IS NOT NULL AS cron_present \gset
\if :cron_present
 SELECT jobname,schedule,active FROM cron.job WHERE jobname='spark-note-reminders';
\endif
SELECT to_regclass('private.note_reminder_worker_config') IS NOT NULL AS config_present \gset
\if :config_present
 SELECT nullif(to_jsonb(c)->>'worker_url','') IS NOT NULL AS worker_configured,
 to_jsonb(c)->>'worker_url' AS worker_url,
 to_jsonb(c)->>'last_tick_at' AS last_tick_at,
 to_jsonb(c)->>'last_error' AS last_error,
 to_jsonb(c)->>'last_http_status' AS last_http_status,
 to_jsonb(c)->>'last_request_id' AS last_request_id
 FROM private.note_reminder_worker_config c;
 SELECT to_regclass('net._http_response') IS NOT NULL AS net_response_present \gset
 \if :net_response_present
  SELECT r.id,r.status_code,r.timed_out,r.error_msg
  FROM net._http_response r JOIN private.note_reminder_worker_config c
   ON r.id=nullif(to_jsonb(c)->>'last_request_id','')::bigint;
 \endif
\endif
SELECT to_regclass('private.note_reminder_deliveries') IS NOT NULL AS queue_present \gset
\if :queue_present
 SELECT channel,status,last_error,count(*) AS jobs,min(created_at) AS oldest_job,
 max(created_at) AS newest_job FROM private.note_reminder_deliveries
 GROUP BY channel,status,last_error ORDER BY channel,status;
\endif
SELECT count(*) AS overdue_not_materialized FROM public.notes n
 WHERE (to_jsonb(n)->>'remind_at')::timestamptz<=now()
 AND to_jsonb(n)->>'reminder_sent_at' IS NULL AND to_jsonb(n)->>'status'='active';
