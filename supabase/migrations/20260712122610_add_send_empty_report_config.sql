-- Add send_empty_report config option
ALTER TABLE daily_report_config
  ADD COLUMN IF NOT EXISTS send_empty_report boolean NOT NULL DEFAULT true;

-- Add skipped_no_calendar_meetings as valid status in daily_report_runs
-- (no constraint to alter — status is text, so just document it)
COMMENT ON COLUMN daily_report_runs.status IS 'Valid statuses: completed, failed, missed, skipped_not_time, skipped_day, skipped_no_recipients, skipped_no_calendar_meetings, already_processed, running';
