-- Drop the unsafe admin-only INSERT/UPDATE policies on the `profiles`
-- storage bucket that were reintroduced by migration
-- 20260719193000_restore_admin_avatar_write_profiles_bucket.
-- Direct writes to the legacy `profiles` bucket are no longer permitted
-- for any user (including admins); avatar uploads must go through the
-- `avatar-upload` Edge Function, which validates content server-side and
-- writes to the private `avatar-quarantine` bucket using the service role.

DROP POLICY IF EXISTS "Admins can upload avatars to profiles bucket" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update avatars in profiles bucket" ON storage.objects;
