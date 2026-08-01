/*
# Fix notification_outbox CHECK constraints

1. channel: add 'in_app' to allowed values
2. status: add 'partial' and 'processed' to allowed values

Uses ALTER TABLE DROP CONSTRAINT + ADD CONSTRAINT to replace.
*/

ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_channel_check;
ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_channel_check
  CHECK (channel = ANY (ARRAY['sms', 'bale', 'in_app']));

ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_status_check;
ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_status_check
  CHECK (status = ANY (ARRAY['pending', 'processing', 'partial', 'processed', 'sent', 'failed']));
