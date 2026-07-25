# Avatar Security — Deployment Guide

This document describes how to deploy the avatar processing pipeline end-to-end.

## Architecture Overview

```
Frontend (ProfilePage) ──► avatar-upload Edge Function ──► avatar-quarantine bucket
                                      │                          │
                                      ▼                          │
                              create_avatar_job RPC             │
                                      │                          │
                                      ▼                          ▼
                              avatar_jobs table  ◄────  Avatar Worker (Docker)
                                      │                          │
                                      ▼                          ▼
                              (poll status)              avatars bucket (public)
                                      │                          │
                                      ▼                          ▼
                              profile.avatar_url  ◄────  complete_avatar_job RPC
```

## Prerequisites

1. **Supabase project** with:
   - `profiles` table (must have `avatar_storage_path` column)
   - `avatar_jobs` table
   - All avatar RPCs (11 functions, SECURITY DEFINER)
   - `avatar-quarantine` bucket (private, 2 MiB, JPEG/PNG/WebP)
   - `avatars` bucket (public, 2 MiB, WebP only)
   - `public_read_avatars` storage policy
   - `select_own_avatar_jobs` RLS policy on `avatar_jobs`

2. **Docker** on the VPS (for the worker container)

3. **Environment variables** for the worker (see below)

## Deployment Order

### Step 1: Apply Database Migrations

Migrations must be applied in this order on a fresh database:

1. `20260718171418_avatar_processing_phase1_base.sql` — adds `profiles.avatar_storage_path`, creates `avatar_jobs` table, RLS, indexes
2. `20260718171717_avatar_processing_phase1_status_index_fix.sql` — adds `retry_wait` to status constraint, widens claim index
3. `20260718172034_avatar_processing_phase1_create_claim_rpcs.sql` — `create_avatar_job`, `claim_next_avatar_job`
4. `20260718172427_avatar_processing_phase1_heartbeat_fail_rpcs.sql` — `heartbeat_avatar_job`, `fail_avatar_job`
5. `20260718172715_avatar_processing_phase1_complete_rpc.sql` — `complete_avatar_job`
6. `20260718173141_avatar_processing_phase1_cleanup_claim_heartbeat_rpcs.sql` — `claim_avatar_cleanup_job`, `heartbeat_avatar_cleanup_job`
7. `20260718173506_avatar_processing_phase1_cleanup_progress_fail_rpcs.sql` — `mark_avatar_cleanup_progress`, `fail_avatar_cleanup_job`
8. `20260718173843_avatar_processing_phase1_final_reclaim_and_mark_fix.sql` — `reclaim_avatar_jobs`, `reclaim_avatar_cleanup_jobs` fixes
9. `20260718173859_avatar_processing_phase1_fix_reclaim_where_clause.sql` — reclaim WHERE clause fix
10. `20260718180000_avatar_storage_buckets.sql` — `avatar-quarantine` + `avatars` buckets, `public_read_avatars` policy

All migrations are idempotent and can be safely re-applied.

### Step 2: Deploy the avatar-upload Edge Function

```bash
# Deploy via Supabase MCP or Supabase CLI
supabase functions deploy avatar-upload --no-verify-jwt
```

The edge function requires these environment variables (configured automatically by Supabase):
- `SUPABASE_URL` — project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (bypasses RLS for quarantine upload + job creation)
- `SUPABASE_ANON_KEY` — anon key (for JWT verification only)

### Step 3: Build and Run the Avatar Worker

The worker runs as a Docker container on the VPS.

#### Environment Variables

Create a `.env` file **outside the repository** (e.g., `/opt/avatar-worker/.env`):

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
AVATAR_WORKER_ID=avatar-worker-1
```

> **WARNING**: Never commit the real `.env` file. Use `worker/.env.example` as a template.

#### Docker Compose

Merge `worker/docker-compose.snippet.yml` into your main `docker-compose.yml`:

```yaml
services:
  avatar-worker:
    build:
      context: ./worker
      dockerfile: Dockerfile
    container_name: avatar-worker
    restart: unless-stopped
    env_file: /opt/avatar-worker/.env  # path to your env file
    mem_limit: 512m
    cpus: 0.5
    read_only: true
    tmpfs:
      - /tmp:size=64m,mode=1777
    networks:
      - default
```

Build and start:

```bash
docker compose up -d avatar-worker
```

### Step 4: Deploy Frontend

The frontend (`ProfilePage.tsx`) calls `supabase.functions.invoke('avatar-upload')` with multipart/form-data and polls `avatar_jobs` for status updates.

No additional frontend configuration is needed — the Supabase client is already initialized.

> **IMPORTANT**: The worker must be running before users try to upload avatars. If the worker is down, uploads will succeed (job created) but processing will never complete — users will see "processing" until the 60-second timeout.

## Health Checks and Logs

### Worker Health

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' avatar-worker

# View worker logs
docker logs avatar-worker

# Follow logs
docker logs -f avatar-worker
```

The worker writes a health timestamp to `/tmp/worker-health` on every successful poll cycle. The Docker HEALTHCHECK runs `healthcheck.js` every 30 seconds, which verifies the timestamp is less than 60 seconds old.

### Checking avatar_jobs

```sql
-- Recent jobs
SELECT id, user_id, status, attempt_count, created_at, completed_at, last_error
FROM avatar_jobs
ORDER BY created_at DESC
LIMIT 20;

-- Jobs stuck in processing
SELECT id, user_id, worker_id, started_at, heartbeat_at
FROM avatar_jobs
WHERE status = 'processing' AND heartbeat_at < now() - interval '5 minutes';

-- Failed jobs
SELECT id, user_id, status, attempt_count, last_error, created_at
FROM avatar_jobs
WHERE status = 'failed'
ORDER BY created_at DESC;
```

### Checking Storage Files

```sql
-- Quarantine files (should be cleaned up after processing)
SELECT name, created_at
FROM storage.objects
WHERE bucket_id = 'avatar-quarantine'
ORDER BY created_at DESC;

-- Processed avatars
SELECT name, created_at
FROM storage.objects
WHERE bucket_id = 'avatars'
ORDER BY created_at DESC;

-- Orphan quarantine files (jobs completed but quarantine not deleted)
SELECT aj.id, aj.quarantine_path, aj.status, aj.quarantine_deleted_at
FROM avatar_jobs aj
WHERE aj.status = 'completed'
  AND aj.quarantine_deleted_at IS NULL
  AND aj.cleanup_status = 'completed';
```

## End-to-End Test

1. Sign in to the app
2. Go to Profile page
3. Upload a JPEG, PNG, or WebP file (max 2 MiB)
4. Verify "processing" message appears
5. Wait for the worker to process (typically 2-10 seconds)
6. Verify avatar updates in the UI
7. Check `avatar_jobs` table for status = `completed`
8. Check `avatars` bucket for the processed WebP file
9. Check `avatar-quarantine` bucket — the quarantine file should be deleted

## Rollback

### Disable the Pipeline

1. Stop the worker: `docker compose stop avatar-worker`
2. Revert `ProfilePage.tsx` to use direct upload (git revert the frontend commit)
3. Redeploy frontend

### Remove Avatar Tables (Destructive — only for clean removal)

```sql
-- WARNING: This deletes all avatar job history
DROP TABLE IF EXISTS public.avatar_jobs;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS avatar_storage_path;
DROP POLICY IF EXISTS "public_read_avatars" ON storage.objects;
-- Buckets must be emptied before they can be deleted
-- DELETE FROM storage.objects WHERE bucket_id IN ('avatar-quarantine', 'avatars');
-- DELETE FROM storage.buckets WHERE id IN ('avatar-quarantine', 'avatars');
```

## Security Notes

- The `avatar-upload` edge function validates JWT, checks magic bytes (not just MIME type), enforces 2 MiB file limit, and uses safe UUID-based storage paths.
- The worker processes images with Sharp, strips all metadata (EXIF, ICC, XMP), and outputs 512x512 WebP at quality 82.
- `avatar-quarantine` is private — files are not publicly accessible.
- `avatars` is public-read only — no public write access.
- All RPCs are SECURITY DEFINER and intended for service-role use only.
- `authenticated` users can only SELECT their own `avatar_jobs` rows.
