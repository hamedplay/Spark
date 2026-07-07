-- Add delivery tracking columns to sms_dispatch_logs
-- provider_message_id: generic provider-assigned message ID (e.g. Rahyab Return ID, sms.ir message ID)
-- delivery_status: actual delivery outcome from provider
-- delivery_code: raw code returned by provider delivery endpoint
-- delivery_checked_at: timestamp of last delivery status query

ALTER TABLE sms_dispatch_logs
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS delivery_code text,
  ADD COLUMN IF NOT EXISTS delivery_checked_at timestamptz;

-- Optional: index for filtering by delivery_status in future reports
CREATE INDEX IF NOT EXISTS idx_sms_dispatch_logs_delivery_status
  ON sms_dispatch_logs (delivery_status)
  WHERE delivery_status IS NOT NULL;
