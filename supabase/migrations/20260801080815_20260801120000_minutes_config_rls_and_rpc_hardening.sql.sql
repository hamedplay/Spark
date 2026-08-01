/*
# Minutes Config RLS Access + RPC Hardening

## Purpose
1. Grant authenticated users read access to `system_config` rows where `section = 'minutes'`
   so non-admin users can load minutes layout config.
2. Add admin-only DELETE policy for `system_config`.
3. REVOKE EXECUTE from anon/PUBLIC on all minutes-related SECURITY DEFINER functions,
   and GRANT EXECUTE only to authenticated for public API functions.
   Internal helpers (prefixed with `_`) and trigger functions: revoke from both anon and authenticated.

## Changes
### RLS Policies on system_config
- Replace `authenticated_read_system_config` to include `minutes` section.
- Add `Admins can delete system_config` policy.

### RPC Grants
- REVOKE EXECUTE FROM PUBLIC and FROM anon on all minutes-related functions (by OID to handle overloads).
- GRANT EXECUTE TO authenticated only on public API functions.
- Internal helpers and trigger functions: revoke from both anon and authenticated.

## Security
- No new INSERT/UPDATE/DELETE permissions for non-admin users.
- anon cannot read minutes config or execute minutes RPCs.
- All functions already have `search_path = ""` (verified).
- Changes are additive and idempotent.
*/

-- ── 1. RLS: Allow authenticated to read minutes section ──────────────────

DROP POLICY IF EXISTS "authenticated_read_system_config" ON system_config;
CREATE POLICY "authenticated_read_system_config"
  ON system_config FOR SELECT
  TO authenticated
  USING (section = ANY (ARRAY['general'::text, 'appearance'::text, 'spark'::text, 'minutes'::text]));

-- ── 2. Admin DELETE policy ────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins can delete system_config" ON system_config;
CREATE POLICY "Admins can delete system_config"
  ON system_config FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.user_id = auth.uid() AND profiles.is_admin = true
  ));

-- ── 3. RPC Hardening: REVOKE anon/PUBLIC, GRANT authenticated ─────────────

DO $$
DECLARE
  r record;
  -- Public API function names (called from frontend by authenticated users)
  public_api_names text[] := ARRAY[
    'approve_minute_revision',
    'begin_minutes_attachment_upload',
    'can_create_minutes_for_meeting',
    'can_manage_minutes_submission',
    'can_view_restricted_minutes_meeting',
    'cleanup_pending_minutes_attachments',
    'confirm_and_publish_minutes_by_chair',
    'confirm_minutes_by_secretary',
    'create_minutes_attachment_record',
    'create_minutes_draft',
    'delete_minutes_attachment',
    'finalize_minutes_attachment',
    'get_minutes_attachment_signed_url',
    'get_minutes_dashboard_stats',
    'get_minutes_decisions_for_view',
    'get_my_minutes_decisions',
    'get_my_minutes_decisions_summary',
    'get_trackable_minutes_decisions',
    'get_trackable_minutes_decisions_summary',
    'has_any_trackable_minutes_decision',
    'manage_minutes_decision',
    'request_minutes_changes',
    'resolve_my_minutes_decision_obstacle',
    'search_decisions_report',
    'search_minutes_report',
    'submit_minutes_for_approval',
    'update_minutes_draft',
    'update_my_minutes_decision'
  ];
  -- Internal helper names (prefixed with _) — revoke from both anon AND authenticated
  internal_names text[] := ARRAY[
    '_can_track_decisions',
    '_can_view_minute',
    '_create_minutes_notification',
    '_minutes_attachment_target_ok',
    '_minutes_user_belongs_to_meeting',
    '_sync_minutes_decisions',
    '_user_can_manage_minute_content',
    '_user_can_view_minute',
    '_write_minutes_audit'
  ];
  -- Trigger function names — revoke from both anon AND authenticated
  trigger_names text[] := ARRAY[
    '_minutes_audit_trigger_fn',
    '_minutes_decisions_audit_trigger_fn',
    'check_minutes_immutable_fields',
    'minutes_agenda_item_belongs_to_meeting',
    'minutes_set_updated_at'
  ];
  -- Maintenance function names — service-role only
  maintenance_names text[] := ARRAY[
    'cleanup_orphan_minutes_attachments'
  ];
BEGIN
  -- Public API functions: revoke from PUBLIC and anon, grant to authenticated
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = ANY(public_api_names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.oid::regprocedure);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.oid::regprocedure);
  END LOOP;

  -- Internal helper functions: revoke from PUBLIC, anon, and authenticated
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = ANY(internal_names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.oid::regprocedure);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.oid::regprocedure);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.oid::regprocedure);
  END LOOP;

  -- Trigger functions: revoke from PUBLIC, anon, and authenticated
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = ANY(trigger_names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.oid::regprocedure);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.oid::regprocedure);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.oid::regprocedure);
  END LOOP;

  -- Maintenance functions: revoke from PUBLIC, anon, and authenticated
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = ANY(maintenance_names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.oid::regprocedure);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.oid::regprocedure);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.oid::regprocedure);
  END LOOP;
END
$$;
