-- Operator-approved date: 1405/07/05 (2026-09-27 in Asia/Tehran).
-- This is an explicit repair decision, not a recovered historical fact.
-- Match the existing series' convention: local midnight stored as UTC text.
-- Do not create a missing meeting, overwrite a known date, or replay old SMS.
UPDATE public.meetings
SET request_date = '2026-09-26T20:30:00.000Z',
    request_jalaali_date = '1405/07/05'
WHERE id = '5a41768f-d4f7-4015-b2c8-1b52ca1d5c56'::uuid
  AND btrim(subject) = 'جلسه کنترل پروژه مرکز داده اصلی بانک'
  AND status = 'archived'
  AND status_type = 'scheduled'
  AND request_date IS NULL
  AND request_jalaali_date IS NULL;
