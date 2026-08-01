/*
# Transition org-level grants for sensitive Minutes permissions

## Summary

Currently all 7 minutes permissions are granted=true for org levels 1-8.
This makes group-level toggles ineffective — every user with a position
gets full access regardless of group membership.

This migration transitions the sensitive permissions to false for most
levels, while keeping basic access (view, create, edit) open to avoid
service disruption.

## Current state (verified before migration)
  - 28 total users, 27 active, 2 admins
  - 16 users with positions
  - 4 published minutes, 0 pending approvals, 0 draft minutes
  - No active approval workflows at risk
  - No group has any minutes_* keys defined

## Transition plan

### Keep true for ALL levels (1-8) — avoid service disruption:
  - minutes_view
  - minutes_create
  - minutes_edit

### Set to false for levels 2-8, keep true for level 1:
  - minutes_approve
  - minutes_publish
  - minutes_reports
  - minutes_config

### Add new key for ALL levels (true):
  - minutes_decisions.track

Level 1 is treated as a privileged level (directors/managers) that retains
sensitive access. Levels 2-8 lose sensitive access via org-level and must
receive it through group membership or position overrides.

## Admin bypass
  Admins are unaffected — is_current_user_admin() is checked separately
  in all RPC functions and in the frontend permission loader.

## Idempotency
  Uses INSERT ... ON CONFLICT for the new key and UPDATE for existing rows.
  Re-running is safe.

## No data loss
  No DROP, DELETE, TRUNCATE, or CASCADE. Only UPDATE and INSERT.
*/

-- ═══════════════════════════════════════════════════════════════════════
-- Report before counts
-- ═══════════════════════════════════════════════════════════════════════
-- (Informational only — not executed as a separate statement in production)

-- ═══════════════════════════════════════════════════════════════════════
-- Transition sensitive permissions for levels 2-8 to false
-- ═══════════════════════════════════════════════════════════════════════

UPDATE public.org_level_permissions
SET granted = false
WHERE permission_key IN ('minutes_approve', 'minutes_publish', 'minutes_reports', 'minutes_config')
  AND level IN (2, 3, 4, 5, 6, 7, 8);

-- ═══════════════════════════════════════════════════════════════════════
-- Add minutes_decisions.track for all levels (1-8) if not present
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.org_level_permissions (level, permission_key, granted)
SELECT i, 'minutes_decisions.track', true
FROM generate_series(1, 8) AS i
ON CONFLICT (level, permission_key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- Verify: minutes_view, minutes_create, minutes_edit remain true for all levels
-- (no change needed — they are already true)
-- ═══════════════════════════════════════════════════════════════════════
