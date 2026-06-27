ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS work_start_time text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS work_end_time text DEFAULT NULL;