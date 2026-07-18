/*
# Avatar Processing — Phase 1 Base Schema

## Purpose
Introduce the persistent job queue that powers server-side avatar image
processing (validation, resize, webp conversion) and the follow-up cleanup
of the previous avatar file plus the temporary quarantine upload.

This migration ONLY adds schema (one column on `profiles` + one new table),
constraints, indexes, and a single read-only RLS policy. No RPCs, workers,
edge functions, storage policies, or frontend changes are included here.

## 1. Modified table: `public.profiles`
- `avatar_storage_path` (text, nullable): path of the user's current avatar
  object inside the avatars storage bucket. NULL means no processed avatar
  has been stored yet. Existing rows are NOT modified — the column simply
  becomes available and defaults to NULL.

## 2. New table: `public.avatar_jobs`
Persistent, idempotent job queue for avatar processing + cleanup.

### Core processing columns
- `id` (uuid, PK, default gen_random_uuid())
- `user_id` (uuid, NOT NULL) — owner; FK to `public.profiles(user_id)`
  ON DELETE CASCADE (a deleted profile removes its avatar jobs).
- `quarantine_path` (text, NOT NULL) — storage path of the raw uploaded
  file held in the quarantine bucket pending validation.
- `output_path` (text, nullable) — final storage path of the processed
  webp avatar (set on completion).
- `status` (text, NOT NULL, default 'pending') — CHECK in
  ('pending','processing','completed','failed').
- `attempt_count` (integer, NOT NULL, default 0) — incremented on each
  claim of the main processing job.
- `max_attempts` (integer, NOT NULL, default 3) — hard cap before the main
  job is marked `failed`.
- `worker_id` (text, nullable) — id of the main processing worker that
  currently owns the job.
- `started_at` (timestamptz, nullable) — when the current main attempt
  started.
- `heartbeat_at` (timestamptz, nullable) — last heartbeat from the main
  worker; used by reclaim.
- `completed_at` (timestamptz, nullable) — set when `status='completed'`.
- `next_retry_at` (timestamptz, nullable) — earliest time a failed main
  job may be reclaimed; NULL = immediately eligible.
- `last_error` (text, nullable) — diagnostic text from the last main
  processing failure (for reporting only; retry decisions are based on
  `attempt_count`, not on parsing this column).
- `created_at` (timestamptz, default now())
- `updated_at` (timestamptz, default now())

### Cleanup columns
Cleanup runs AFTER the main job reaches `status='completed'`. Until then
`cleanup_status` stays NULL and cleanup workers ignore the row.
- `previous_avatar_path` (text, nullable) — storage path of the avatar
  that was active before this job replaced it. Captured atomically at
  completion time. NULL means the user had no prior avatar, so the
  "delete old avatar" step is considered already done.
- `cleanup_status` (text, nullable, default NULL) — CHECK (NULL or in
  ('pending','processing','completed','failed')). Only set to 'pending'
  by the completion RPC; stays NULL for non-completed jobs.
- `cleanup_worker_id` (text, nullable) — id of the cleanup worker that
  currently owns the cleanup.
- `cleanup_started_at` (timestamptz, nullable)
- `cleanup_heartbeat_at` (timestamptz, nullable)
- `cleanup_attempt_count` (integer, NOT NULL, default 0) — incremented
  on each cleanup claim.
- `cleanup_next_retry_at` (timestamptz, nullable) — earliest retry time
  after a transient cleanup failure; NULL = immediately eligible.
- `cleanup_last_error` (text, nullable) — diagnostic text only.
- `old_avatar_deleted_at` (timestamptz, nullable) — timestamp the
  previous avatar object was confirmed deleted.
- `quarantine_deleted_at` (timestamptz, nullable) — timestamp the
  quarantine object was confirmed deleted.

### Constraints
- PK on `id`.
- FK `user_id` -> `public.profiles(user_id)` ON DELETE CASCADE.
- CHECK `avatar_jobs_status_check`: status in
  ('pending','processing','completed','failed').
- CHECK `avatar_jobs_cleanup_status_check`: cleanup_status IS NULL or in
  ('pending','processing','completed','failed').

### Indexes
- `idx_avatar_jobs_claim` — (status, next_retry_at, updated_at) WHERE
  status='pending'. Accelerates main-worker claim queries.
- `idx_avatar_jobs_reclaim` — (status, heartbeat_at) WHERE
  status='processing'. Accelerates main-worker reclaim of stale jobs.
- `idx_avatar_jobs_cleanup_claim` — (cleanup_status,
  cleanup_next_retry_at, updated_at) WHERE cleanup_status='pending'.
  Accelerates cleanup-worker claim queries.
- `idx_avatar_jobs_cleanup_reclaim` — (cleanup_status,
  cleanup_heartbeat_at) WHERE cleanup_status='processing'. Accelerates
  cleanup-worker reclaim of stale cleanups.

## 3. Security (RLS)
- RLS ENABLED on `public.avatar_jobs`.
- SELECT policy `select_own_avatar_jobs` for `authenticated`:
  `auth.uid() = user_id`. Users can see only their own avatar jobs.
- NO INSERT / UPDATE / DELETE policies for `authenticated` — all writes
  are performed by service-role workers / RPCs that bypass RLS.
- `anon` has NO policy and therefore NO access.

## 4. Important notes
1. Idempotent & low-risk: uses `IF NOT EXISTS` for the table, column
   addition, indexes; policies are dropped-if-exists before creation.
2. No existing `profiles` data is changed; the new column is nullable
   with no default, so existing rows simply get NULL.
3. No RPCs, no storage policy changes, no edge functions, no frontend
   changes in this migration.
*/

-- 1. Add avatar_storage_path to profiles (nullable, no default, idempotent)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_storage_path text;

-- 2. Create avatar_jobs table
CREATE TABLE IF NOT EXISTS public.avatar_jobs (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        NOT NULL,
  quarantine_path          text        NOT NULL,
  output_path              text,
  status                   text        NOT NULL DEFAULT 'pending',
  attempt_count            integer     NOT NULL DEFAULT 0,
  max_attempts             integer     NOT NULL DEFAULT 3,
  worker_id                text,
  started_at               timestamptz,
  heartbeat_at             timestamptz,
  completed_at             timestamptz,
  next_retry_at            timestamptz,
  last_error               text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- Cleanup columns
  previous_avatar_path     text,
  cleanup_status           text        DEFAULT NULL,
  cleanup_worker_id        text,
  cleanup_started_at       timestamptz,
  cleanup_heartbeat_at     timestamptz,
  cleanup_attempt_count    integer     NOT NULL DEFAULT 0,
  cleanup_next_retry_at    timestamptz,
  cleanup_last_error       text,
  old_avatar_deleted_at    timestamptz,
  quarantine_deleted_at    timestamptz,

  CONSTRAINT avatar_jobs_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES public.profiles (user_id)
    ON DELETE CASCADE,

  CONSTRAINT avatar_jobs_status_check
    CHECK (status IN ('pending','processing','completed','failed')),

  CONSTRAINT avatar_jobs_cleanup_status_check
    CHECK (cleanup_status IS NULL
           OR cleanup_status IN ('pending','processing','completed','failed'))
);

-- 3. Indexes for claim / reclaim (main processing)
CREATE INDEX IF NOT EXISTS idx_avatar_jobs_claim
  ON public.avatar_jobs (status, next_retry_at, updated_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_avatar_jobs_reclaim
  ON public.avatar_jobs (status, heartbeat_at)
  WHERE status = 'processing';

-- Indexes for claim / reclaim (cleanup)
CREATE INDEX IF NOT EXISTS idx_avatar_jobs_cleanup_claim
  ON public.avatar_jobs (cleanup_status, cleanup_next_retry_at, updated_at)
  WHERE cleanup_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_avatar_jobs_cleanup_reclaim
  ON public.avatar_jobs (cleanup_status, cleanup_heartbeat_at)
  WHERE cleanup_status = 'processing';

-- 4. RLS
ALTER TABLE public.avatar_jobs ENABLE ROW LEVEL SECURITY;

-- SELECT only own jobs; no INSERT/UPDATE/DELETE policies for authenticated.
DROP POLICY IF EXISTS "select_own_avatar_jobs" ON public.avatar_jobs;
CREATE POLICY "select_own_avatar_jobs"
  ON public.avatar_jobs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
