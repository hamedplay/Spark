/*
# Avatar Storage — Quarantine & Avatars Buckets + Public Read Policy

## Purpose
Idempotent migration that creates the two storage buckets required by the
avatar processing pipeline and the public-read policy on the `avatars` bucket.
This migration was originally applied via `execute_sql` during development;
this file makes it part of the repository so a fresh database can be deployed
in one pass.

## Buckets
1. `avatar-quarantine` (private) — raw uploads from the `avatar-upload` edge
   function, held pending validation by the worker.
   - public: false
   - file_size_limit: 2 MiB (2_097_152 bytes)
   - allowed_mime_types: image/jpeg, image/png, image/webp
2. `avatars` (public) — processed WebP avatars served to the frontend.
   - public: true
   - file_size_limit: 2 MiB (2_097_152 bytes)
   - allowed_mime_types: image/webp

## Storage Policy
- `public_read_avatars` — SELECT (anon, authenticated) on storage.objects
  WHERE bucket_id = 'avatars'. Allows public read access to processed avatars.
- No INSERT/UPDATE/DELETE policies for authenticated on these buckets — all
  writes are performed by the service-role edge function and worker.

## Safety
- Uses `IF NOT EXISTS` for bucket creation — non-destructive.
- Policy is dropped-if-exists before creation.
- Does NOT touch `profiles` or `chat-attachments` buckets.
*/

-- 1. avatar-quarantine bucket (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatar-quarantine', 'avatar-quarantine', false, 2097152, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- 2. avatars bucket (public)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/webp'])
ON CONFLICT (id) DO NOTHING;

-- 3. Public read policy for avatars bucket
DROP POLICY IF EXISTS "public_read_avatars" ON storage.objects;
CREATE POLICY "public_read_avatars"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'avatars');
