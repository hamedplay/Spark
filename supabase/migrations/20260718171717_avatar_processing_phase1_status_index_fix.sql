/*
# Avatar Processing — Phase 1 Status/Index Fix

## Purpose
Align the `avatar_jobs` schema with the finalized worker design by adding
the `retry_wait` status and widening the main-worker claim index to cover
both `pending` and `retry_wait` rows.

## 1. CHECK constraint `avatar_jobs_status_check`
The previous migration allowed only:
  pending, processing, completed, failed.
The final design also needs `retry_wait` (a transient state for jobs that
failed once and are waiting for their backoff window to elapse before being
re-claimed). This migration replaces the constraint with one accepting:
  pending, processing, completed, failed, retry_wait.

The replacement is done with DROP + ADD (CHECK constraints cannot be
ALTERed in place). The DROP is guarded by `IF EXISTS`, so the migration is
idempotent and safe to re-run.

## 2. Claim index `idx_avatar_jobs_claim`
The previous index was a partial index scoped to `status = 'pending'` only:
  CREATE INDEX ... (status, next_retry_at, updated_at)
  WHERE status = 'pending';

The main worker must be able to claim BOTH:
  - `pending` rows (always eligible), and
  - `retry_wait` rows that are eligible because
    `next_retry_at IS NULL OR next_retry_at <= now()`.

PostgreSQL partial-index predicates cannot reference `now()` (it is not
immutable), so the time eligibility test is applied inside the claim RPC,
not in the index predicate. The index is therefore widened to a partial
index over both statuses, keeping `next_retry_at` and `updated_at` as key
columns so the RPC's `ORDER BY next_retry_at NULLS FIRST, updated_at` and
its `next_retry_at` filter can both be served from the index.

This migration drops the old `idx_avatar_jobs_claim` and creates the new
one. Both operations are `IF EXISTS` / `IF NOT EXISTS` for idempotency.

## 3. Important notes
1. Idempotent & low-risk: guarded DROP/ADD for the constraint and
   guarded DROP/CREATE for the index.
2. No existing row data is modified or deleted; existing rows keep their
   current `status` values, all of which remain valid under the new
   constraint.
3. No RPCs, storage policies, edge functions, workers, or frontend
   changes in this migration.
*/

-- 1. Replace the status CHECK constraint to include 'retry_wait'
ALTER TABLE public.avatar_jobs
  DROP CONSTRAINT IF EXISTS avatar_jobs_status_check;

ALTER TABLE public.avatar_jobs
  ADD CONSTRAINT avatar_jobs_status_check
  CHECK (status IN ('pending','processing','completed','failed','retry_wait'));

-- 2. Replace the main-worker claim index to cover pending + retry_wait
DROP INDEX IF EXISTS public.idx_avatar_jobs_claim;

CREATE INDEX IF NOT EXISTS idx_avatar_jobs_claim
  ON public.avatar_jobs (status, next_retry_at, updated_at)
  WHERE status IN ('pending','retry_wait');
