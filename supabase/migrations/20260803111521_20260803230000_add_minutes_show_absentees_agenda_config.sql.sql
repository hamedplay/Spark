/*
# Add minutes_show_absentees and minutes_show_agenda config keys

## Purpose
- Inserts two new system_config rows for toggling display of absentees and agenda
  in the minutes document layout (preview, print, Word export).
- `minutes_show_absentees` controls whether the "غایبین جلسه" field is shown.
- `minutes_show_agenda` controls whether the "دستور جلسات" section is shown.
- Both default to 'true' so existing documents are unaffected.

## Changes
- INSERT into system_config:
  - section='minutes', key='minutes_show_absentees', value='true', value_type='boolean', label='نمایش غایبین'
  - section='minutes', key='minutes_show_agenda', value='true', value_type='boolean', label='نمایش دستور جلسات'
- Uses ON CONFLICT (section, key) DO NOTHING — idempotent, safe to re-run.
- Existing config rows are NOT modified or overwritten.

## Security
- No RLS changes. No table structure changes.
- No data deletion, reset, or truncation.
- Current access to system_config is preserved.
*/

INSERT INTO system_config (section, key, value, value_type, label)
VALUES ('minutes', 'minutes_show_absentees', 'true', 'boolean', 'نمایش غایبین')
ON CONFLICT (section, key) DO NOTHING;

INSERT INTO system_config (section, key, value, value_type, label)
VALUES ('minutes', 'minutes_show_agenda', 'true', 'boolean', 'نمایش دستور جلسات')
ON CONFLICT (section, key) DO NOTHING;
