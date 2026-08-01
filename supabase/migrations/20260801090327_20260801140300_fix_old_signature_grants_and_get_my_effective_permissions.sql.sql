/*
# Fix grants on old function signatures and get_my_effective_permissions

CREATE OR REPLACE with a new signature creates a new function alongside the old one.
The old signatures of create_minutes_draft(jsonb) and update_minutes_draft(uuid, timestamptz, jsonb)
still exist with anon EXECUTE grants. This migration revokes those dangerous grants.

Also revokes anon from get_my_effective_permissions (it got a default PUBLIC grant).

No DROP, no data changes — only REVOKE and GRANT statements.
*/

-- Revoke anon/authenticated from old create_minutes_draft(jsonb) signature
REVOKE EXECUTE ON FUNCTION public.create_minutes_draft(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_minutes_draft(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_minutes_draft(jsonb) FROM authenticated;

-- Revoke anon/authenticated from old update_minutes_draft(uuid, timestamptz, jsonb) signature
REVOKE EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamp with time zone, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamp with time zone, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamp with time zone, jsonb) FROM authenticated;

-- Revoke anon/PUBLIC from get_my_effective_permissions
REVOKE EXECUTE ON FUNCTION public.get_my_effective_permissions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_effective_permissions() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_effective_permissions() TO authenticated;
