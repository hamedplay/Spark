-- ═══════════════════════════════════════════════════════════════════
-- Phase 3-B: Lock two system-only functions to service_role
-- ---------------------------------------------------------------
-- trigger_daily_meetings_send:
--   Called only by pg_cron (service_role). No user-facing call site.
--   Any anon/authenticated could previously trigger mass SMS/Bale spam.
--
-- get_sms_dispatch_info:
--   Currently called from notifications.ts:115 with user JWT.
--   ** BREAKING CHANGE **: Revoking from authenticated will break that
--   frontend path. Callers must migrate to an Edge Function proxy.
--   Included here per explicit architecture decision.
--
-- service_role retains EXECUTE by default — no GRANT needed.
-- ═══════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.trigger_daily_meetings_send()              FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_sms_dispatch_info(uuid, text)          FROM authenticated;
