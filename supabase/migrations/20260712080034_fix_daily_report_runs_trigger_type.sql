-- ============================================================
-- Migration: Fix daily_report_runs — add trigger_type and run_key
-- ============================================================

-- Add trigger_type and run_key columns
ALTER TABLE daily_report_runs
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'scheduled';

ALTER TABLE daily_report_runs
  ADD COLUMN IF NOT EXISTS run_key text NOT NULL DEFAULT '';

-- Add check constraint for trigger_type
ALTER TABLE daily_report_runs
  DROP CONSTRAINT IF EXISTS daily_report_runs_trigger_type_check;
ALTER TABLE daily_report_runs
  ADD CONSTRAINT daily_report_runs_trigger_type_check
  CHECK (trigger_type IN ('scheduled', 'manual'));

-- Drop the old unique constraint on (config_id, report_date)
ALTER TABLE daily_report_runs
  DROP CONSTRAINT IF EXISTS daily_report_runs_config_id_report_date_key;

-- Add unique constraint on run_key instead
ALTER TABLE daily_report_runs
  ADD CONSTRAINT daily_report_runs_run_key_unique UNIQUE (run_key);

-- Add a separate unique constraint for scheduled runs per day
-- (only one scheduled run per config per day, but multiple manual runs allowed)
CREATE UNIQUE INDEX IF NOT EXISTS daily_report_runs_scheduled_unique
  ON daily_report_runs (config_id, report_date)
  WHERE trigger_type = 'scheduled';
