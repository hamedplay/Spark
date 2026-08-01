/*
# Seed minutes_view permission for all org levels

1. Purpose
   - Add the `minutes_view` permission key to `org_level_permissions` for all
     existing levels (1 through 8) so that all authenticated users can view
     the minutes module pages by default, matching the current behavior
     where minutes pages are accessible to all authenticated users.
   - Also add `minutes_create`, `minutes_edit`, `minutes_approve`,
     `minutes_publish`, and `minutes_reports` as granted permission keys
     for all levels, so the module is fully functional for all users.
   - The `minutes_decisions.track` permission already exists in
     MINUTES_NAVIGATION_ITEMS and is gated by a runtime RPC check
     (has_any_trackable_minutes_decision), so it is NOT seeded here.

2. Tables Modified
   - `org_level_permissions`: new rows inserted (idempotent via ON CONFLICT).

3. Security
   - No RLS changes.
   - No schema changes.
   - No data deletion.
   - Only additive INSERT statements.

4. Important Notes
   - This migration is idempotent: the unique constraint on
     (level, permission_key) prevents duplicate inserts.
   - All permission keys are granted=true, matching current behavior
     where all authenticated users can access minutes.
   - Admins always have full access via is_admin check, independent
     of this table.
*/

-- Ensure the unique constraint exists (prevents duplicates on re-run)
-- (If it doesn't exist, create it; if it does, this is a no-op)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'org_level_permissions_level_permission_key_key'
  ) THEN
    ALTER TABLE public.org_level_permissions
      ADD CONSTRAINT org_level_permissions_level_permission_key_key
      UNIQUE (level, permission_key);
  END IF;
END $$;

-- Seed minutes_view for all levels
INSERT INTO public.org_level_permissions (id, level, permission_key, granted, created_at)
SELECT gen_random_uuid(), lvl, 'minutes_view', true, now()
FROM generate_series(1, 8) AS lvl
ON CONFLICT (level, permission_key) DO NOTHING;

-- Seed minutes_create for all levels
INSERT INTO public.org_level_permissions (id, level, permission_key, granted, created_at)
SELECT gen_random_uuid(), lvl, 'minutes_create', true, now()
FROM generate_series(1, 8) AS lvl
ON CONFLICT (level, permission_key) DO NOTHING;

-- Seed minutes_edit for all levels
INSERT INTO public.org_level_permissions (id, level, permission_key, granted, created_at)
SELECT gen_random_uuid(), lvl, 'minutes_edit', true, now()
FROM generate_series(1, 8) AS lvl
ON CONFLICT (level, permission_key) DO NOTHING;

-- Seed minutes_approve for all levels
INSERT INTO public.org_level_permissions (id, level, permission_key, granted, created_at)
SELECT gen_random_uuid(), lvl, 'minutes_approve', true, now()
FROM generate_series(1, 8) AS lvl
ON CONFLICT (level, permission_key) DO NOTHING;

-- Seed minutes_publish for all levels
INSERT INTO public.org_level_permissions (id, level, permission_key, granted, created_at)
SELECT gen_random_uuid(), lvl, 'minutes_publish', true, now()
FROM generate_series(1, 8) AS lvl
ON CONFLICT (level, permission_key) DO NOTHING;

-- Seed minutes_reports for all levels
INSERT INTO public.org_level_permissions (id, level, permission_key, granted, created_at)
SELECT gen_random_uuid(), lvl, 'minutes_reports', true, now()
FROM generate_series(1, 8) AS lvl
ON CONFLICT (level, permission_key) DO NOTHING;
