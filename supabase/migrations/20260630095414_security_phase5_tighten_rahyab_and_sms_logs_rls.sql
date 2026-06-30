-- ═══════════════════════════════════════════════════════════════════
-- Security Phase 5: Tighten RLS on rahyab_settings, rahyab_inbox,
--                   sms_dispatch_logs
-- ───────────────────────────────────────────────────────────────────
-- rahyab_settings: contains SMS credentials (password, token, soap_url).
--   Old: all 4 verbs USING/WITH CHECK true → any authenticated user.
--   New: all 4 verbs restricted to is_current_user_admin() only.
--
-- rahyab_inbox: incoming SMS messages, no ownership column.
--   Old: all 4 verbs USING/WITH CHECK true → any authenticated user.
--   New: all 4 verbs restricted to is_current_user_admin() only.
--   Note: the only client file that touched this table (RahyabConfigPanel)
--         has no import anywhere in the codebase (dead component).
--
-- sms_dispatch_logs:
--   SELECT: already admin-only — no change needed.
--   INSERT: was WITH CHECK true → any authenticated user.
--   New INSERT: triggered_by_user_id must be NULL, auth.uid(), OR user is admin.
--   Rationale: notifications.ts passes senderId ?? null (may be null for system
--              events); CalendarMeetingForm always passes current userId.
--              Blocking: triggered_by_user_id = some_other_uuid (log spoofing).
--
-- ROLLBACK (Down):
--   -- rahyab_settings
--   DROP POLICY IF EXISTS rahyab_settings_select ON public.rahyab_settings;
--   DROP POLICY IF EXISTS rahyab_settings_insert ON public.rahyab_settings;
--   DROP POLICY IF EXISTS rahyab_settings_update ON public.rahyab_settings;
--   DROP POLICY IF EXISTS rahyab_settings_delete ON public.rahyab_settings;
--   CREATE POLICY rahyab_settings_select ON public.rahyab_settings FOR SELECT TO authenticated USING (true);
--   CREATE POLICY rahyab_settings_insert ON public.rahyab_settings FOR INSERT TO authenticated WITH CHECK (true);
--   CREATE POLICY rahyab_settings_update ON public.rahyab_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
--   CREATE POLICY rahyab_settings_delete ON public.rahyab_settings FOR DELETE TO authenticated USING (true);
--   -- rahyab_inbox
--   DROP POLICY IF EXISTS rahyab_inbox_select ON public.rahyab_inbox;
--   DROP POLICY IF EXISTS rahyab_inbox_insert ON public.rahyab_inbox;
--   DROP POLICY IF EXISTS rahyab_inbox_update ON public.rahyab_inbox;
--   DROP POLICY IF EXISTS rahyab_inbox_delete ON public.rahyab_inbox;
--   CREATE POLICY rahyab_inbox_select ON public.rahyab_inbox FOR SELECT TO authenticated USING (true);
--   CREATE POLICY rahyab_inbox_insert ON public.rahyab_inbox FOR INSERT TO authenticated WITH CHECK (true);
--   CREATE POLICY rahyab_inbox_update ON public.rahyab_inbox FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
--   CREATE POLICY rahyab_inbox_delete ON public.rahyab_inbox FOR DELETE TO authenticated USING (true);
--   -- sms_dispatch_logs
--   DROP POLICY IF EXISTS sms_dispatch_logs_insert_authenticated ON public.sms_dispatch_logs;
--   CREATE POLICY sms_dispatch_logs_insert_authenticated ON public.sms_dispatch_logs FOR INSERT TO authenticated WITH CHECK (true);
-- ═══════════════════════════════════════════════════════════════════

-- ── rahyab_settings ────────────────────────────────────────────────
DROP POLICY IF EXISTS rahyab_settings_select ON public.rahyab_settings;
DROP POLICY IF EXISTS rahyab_settings_insert ON public.rahyab_settings;
DROP POLICY IF EXISTS rahyab_settings_update ON public.rahyab_settings;
DROP POLICY IF EXISTS rahyab_settings_delete ON public.rahyab_settings;

CREATE POLICY rahyab_settings_select ON public.rahyab_settings
  FOR SELECT TO authenticated USING (public.is_current_user_admin());

CREATE POLICY rahyab_settings_insert ON public.rahyab_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_current_user_admin());

CREATE POLICY rahyab_settings_update ON public.rahyab_settings
  FOR UPDATE TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

CREATE POLICY rahyab_settings_delete ON public.rahyab_settings
  FOR DELETE TO authenticated USING (public.is_current_user_admin());

-- ── rahyab_inbox ───────────────────────────────────────────────────
DROP POLICY IF EXISTS rahyab_inbox_select ON public.rahyab_inbox;
DROP POLICY IF EXISTS rahyab_inbox_insert ON public.rahyab_inbox;
DROP POLICY IF EXISTS rahyab_inbox_update ON public.rahyab_inbox;
DROP POLICY IF EXISTS rahyab_inbox_delete ON public.rahyab_inbox;

CREATE POLICY rahyab_inbox_select ON public.rahyab_inbox
  FOR SELECT TO authenticated USING (public.is_current_user_admin());

CREATE POLICY rahyab_inbox_insert ON public.rahyab_inbox
  FOR INSERT TO authenticated WITH CHECK (public.is_current_user_admin());

CREATE POLICY rahyab_inbox_update ON public.rahyab_inbox
  FOR UPDATE TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

CREATE POLICY rahyab_inbox_delete ON public.rahyab_inbox
  FOR DELETE TO authenticated USING (public.is_current_user_admin());

-- ── sms_dispatch_logs INSERT ───────────────────────────────────────
-- SELECT policy ("Admins can read sms_dispatch_logs") is already correct — no change.
DROP POLICY IF EXISTS sms_dispatch_logs_insert_authenticated ON public.sms_dispatch_logs;

CREATE POLICY sms_dispatch_logs_insert_authenticated ON public.sms_dispatch_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    triggered_by_user_id IS NULL
    OR triggered_by_user_id = auth.uid()
    OR public.is_current_user_admin()
  );
