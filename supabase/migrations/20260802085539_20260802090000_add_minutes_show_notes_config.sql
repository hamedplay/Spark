/*
# Add minutes_show_notes config key

1. Purpose
   - Inserts a new system_config row for the "show notes" toggle in the minutes document layout.
   - This controls whether the notes section is displayed in print, preview, final version, and Word export.

2. Changes
   - INSERT into system_config: section='minutes', key='minutes_show_notes', value='true', value_type='boolean', label='نمایش یادداشت‌ها'
   - Uses ON CONFLICT (section, key) DO NOTHING to be idempotent and safe to re-run.

3. Security
   - No RLS changes. No table structure changes.
   - No data deletion, reset, or truncation.

4. Important notes
   - This migration only inserts a new row; it does not modify or delete any existing config rows.
   - The ON CONFLICT clause ensures the migration is safe to re-run.
*/

INSERT INTO system_config (section, key, value, value_type, label)
VALUES ('minutes', 'minutes_show_notes', 'true', 'boolean', 'نمایش یادداشت‌ها')
ON CONFLICT (section, key) DO NOTHING;
