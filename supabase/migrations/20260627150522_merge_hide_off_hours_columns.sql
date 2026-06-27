-- Merge old hide_off_hours data into hide_offhours
UPDATE user_preferences
SET hide_offhours = hide_off_hours
WHERE hide_off_hours = true AND hide_offhours = false;

-- Remove the duplicate old column
ALTER TABLE user_preferences DROP COLUMN IF EXISTS hide_off_hours;
