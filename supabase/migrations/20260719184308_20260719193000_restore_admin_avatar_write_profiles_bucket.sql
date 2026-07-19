-- Restore admin-only avatar writes on the legacy `profiles` bucket.
-- The security migration 20260719190000 dropped ALL write policies on this
-- bucket, which broke the admin avatar upload path in UserManagementPanel.
-- The avatar-upload Edge Function only supports self-upload (JWT user = path
-- owner), so admin uploading on behalf of another user cannot use it.
-- This adds narrow admin-only INSERT/UPDATE policies; the bucket stays closed
-- to normal users. Public read is not restored (the bucket is still public=true
-- so CDN serving continues to work for existing getPublicUrl references).

CREATE POLICY "Admins can upload avatars to profiles bucket"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profiles'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.is_admin = true
    )
  );

CREATE POLICY "Admins can update avatars in profiles bucket"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'profiles'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.is_admin = true
    )
  )
  WITH CHECK (
    bucket_id = 'profiles'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.is_admin = true
    )
  );
