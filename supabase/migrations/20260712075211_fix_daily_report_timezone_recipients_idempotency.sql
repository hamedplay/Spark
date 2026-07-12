-- ============================================================
-- Migration: Fix daily report — timezone, idempotency, cron
-- ============================================================

-- 1. Add timezone column to daily_report_config
ALTER TABLE daily_report_config
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Tehran';

-- 2. Create daily_report_runs table for idempotency
CREATE TABLE IF NOT EXISTS daily_report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES daily_report_config(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Tehran',
  scheduled_time text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  recipient_count integer DEFAULT 0,
  meeting_count integer DEFAULT 0,
  error_text text,
  UNIQUE (config_id, report_date)
);

-- 3. Enable RLS on daily_report_runs
ALTER TABLE daily_report_runs ENABLE ROW LEVEL SECURITY;

-- Only admins can view/manage runs
CREATE POLICY "Admins can view daily_report_runs"
  ON daily_report_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can insert daily_report_runs"
  ON daily_report_runs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update daily_report_runs"
  ON daily_report_runs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_admin = true
    )
  );

-- 4. Add RLS policies for daily_report_config (admin-only)
ALTER TABLE daily_report_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view daily_report_config"
  ON daily_report_config FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can insert daily_report_config"
  ON daily_report_config FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update daily_report_config"
  ON daily_report_config FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can delete daily_report_config"
  ON daily_report_config FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_admin = true
    )
  );

-- 5. Set up pg_cron to call edge function every 5 minutes
-- We use pg_net to make HTTP calls to the edge function
-- The edge function itself checks Tehran time and decides whether to send

-- First, set the cron timezone to UTC (edge function handles Tehran time)
-- The cron job runs every 5 minutes and calls the edge function with { scheduled: true }
-- We use the Supabase anon key + a CRON_SECRET for auth

-- Note: pg_cron is not installed by default, so we schedule via Supabase Dashboard
-- The cron configuration should be:
--   Schedule: */5 * * * *
--   Endpoint: https://<project>.supabase.co/functions/v1/send-daily-meetings
--   Method: POST
--   Headers: { "Authorization": "Bearer <CRON_SECRET>", "Content-Type": "application/json" }
--   Body: { "scheduled": true }

-- For now, we create a SQL function that can be called by pg_cron if installed
CREATE OR REPLACE FUNCTION schedule_daily_report_check()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- This function is a placeholder for pg_cron integration
  -- When pg_cron is enabled, schedule it with:
  -- SELECT cron.schedule('daily-report-check', '*/5 * * * *', 'SELECT schedule_daily_report_check()');
  -- The actual HTTP call to the edge function should be done via pg_net or external scheduler
  NULL;
END;
$$;

-- 6. Update existing config to have timezone
UPDATE daily_report_config SET timezone = 'Asia/Tehran' WHERE timezone IS NULL OR timezone = '';
