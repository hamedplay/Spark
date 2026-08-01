/*
# Add minutes_logo_url config key

## Purpose
Add a dedicated config key for the minutes document logo URL, separate from the
portal-wide `appearance.logo_url`. This prevents changing the portal logo when
only the minutes document logo should change.

## Changes
- INSERT one row into `system_config` with section='minutes', key='minutes_logo_url',
  value='' (empty — falls back to appearance.logo_url then /logo_spark.png).
- Idempotent via ON CONFLICT DO NOTHING.

## Security
- No RLS or grant changes. The row is readable by authenticated users (after the
  previous migration added 'minutes' to the read policy) and writable only by admins.
*/

INSERT INTO system_config (section, key, value, value_type, label)
VALUES ('minutes', 'minutes_logo_url', '', 'string', 'لوگوی صورت‌جلسات')
ON CONFLICT (section, key) DO NOTHING;
