/*
# Fix logo_url and mobile_logo_url in system_config

1. Purpose
   - The `logo_url` and `mobile_logo_url` values in `system_config` point to
     `https://zjmozuivykubdqnizhob.supabase.co/...` which is a stale/wrong
     Supabase project ref. The actual project ref is `icpgvfadixevdjtkllap`.
   - This migration updates the host portion of both URLs to use the correct
     project ref, so the logo images can load without ERR_NAME_NOT_RESOLVED.
   - If the logo files do not exist in the correct project's storage, the
     frontend onError handler (added in Phase 2) will fall back to the
     placeholder.

2. Tables Modified
   - `system_config`: UPDATE on `value` column for keys `logo_url` and
     `mobile_logo_url`.

3. Security
   - No RLS changes.
   - No schema changes.
   - No data deletion.
   - Only UPDATE statements on existing rows.

4. Important Notes
   - This only changes the host in the URL; the storage path
     (`/storage/v1/object/public/portal-assets/...`) is preserved.
   - If the logo files were never uploaded to the current project's storage,
     the URLs will return 404 and the frontend fallback will show the
     placeholder logo.
*/

UPDATE public.system_config
  SET value = REPLACE(value, 'zjmozuivykubdqnizhob.supabase.co', 'icpgvfadixevdjtkllap.supabase.co'),
      updated_at = now()
  WHERE key IN ('logo_url', 'mobile_logo_url')
    AND value LIKE '%zjmozuivykubdqnizhob.supabase.co%';
