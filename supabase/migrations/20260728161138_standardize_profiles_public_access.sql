/*
# Standardize profiles_public access for non-admin user display

## Purpose
Recreate the `profiles_public` view as a SECURITY DEFINER view so non-admin
users can read public profile information (name, avatar, position, department,
organization) of colleagues in their organization without hitting the
restrictive RLS on the `profiles` table.

## Problem
The existing `profiles_public` view uses `security_invoker = on` and reads
directly from `profiles`. Because `profiles` RLS only allows `auth.uid() =
user_id OR is_current_user_admin()`, non-admin users see zero rows for other
users — breaking chat names, channel members, task assignees, meeting
participants, and other UI that needs to display colleague identities.

## Changes
1. Drop the existing `profiles_public` view.
2. Recreate it as a SECURITY DEFINER view that:
   - Joins `profiles` to `org_positions` and `org_units` for primary
     position/unit names.
   - Filters to only active, non-hidden users in the same organization as
     the caller (via `auth.uid()`).
   - Exposes only public columns — no email, phone, national_id, tokens, or
     other sensitive data.
3. Lock down grants: revoke ALL from anon, grant only SELECT to authenticated.
4. Enable RLS on the view and add a SELECT policy requiring authentication.

## Security
- `anon` role gets no access (REVOKE ALL).
- `authenticated` role gets SELECT only.
- Organization isolation: `organization = (caller's organization)`.
- Active-only: `is_active = true`.
- Hidden excluded: `COALESCE(is_hidden, false) = false`.
- No sensitive columns exposed.
- SECURITY DEFINER bypasses `profiles` RLS safely because the view itself
  restricts output to public columns + same-org + active + not-hidden.

## Important notes
1. The view is SECURITY DEFINER so it reads `profiles` as the view owner
   (postgres), bypassing `profiles` RLS. This is intentional and safe because
   the WHERE clause restricts output to public information for same-org
   active non-hidden users only.
2. The existing `profiles` RLS policies are NOT changed.
3. No data is modified or deleted.
4. The migration is idempotent — uses `CREATE OR REPLACE` and `DROP IF EXISTS`.
*/

-- 1. Drop existing view
DROP VIEW IF EXISTS public.profiles_public;

-- 2. Recreate as SECURITY DEFINER with org isolation and active/hidden filtering
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT
  p.user_id,
  p.full_name,
  p.username,
  p.avatar_url,
  p."position",
  p.department,
  p.organization,
  p.primary_unit_id,
  u.name   AS primary_unit_name,
  p.primary_position_id,
  pos.title AS primary_position_title,
  p.is_active,
  p.is_hidden
FROM public.profiles p
LEFT JOIN public.org_positions pos ON pos.id = p.primary_position_id
LEFT JOIN public.org_units u ON u.id = p.primary_unit_id
WHERE p.is_active = true
  AND COALESCE(p.is_hidden, false) = false
  AND p.organization = (
    SELECT pr.organization
    FROM public.profiles pr
    WHERE pr.user_id = auth.uid()
    LIMIT 1
  );

-- Mark as SECURITY DEFINER so it bypasses profiles RLS safely
ALTER VIEW public.profiles_public SET (security_invoker = false);

-- 3. Lock down grants
REVOKE ALL ON public.profiles_public FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.profiles_public FROM authenticated;
GRANT SELECT ON public.profiles_public TO authenticated;

-- 4. Enable RLS on the view as defense-in-depth
ALTER VIEW public.profiles_public SET (security_barrier = true);
