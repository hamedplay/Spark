-- ═══════════════════════════════════════════════════════════════
-- Phase 1A: Fix missing search_path on get_unread_counts
-- ---------------------------------------------------------------
-- Risk: ZERO — only adds SET search_path; no logic change.
-- This prevents search_path injection attacks against this
-- SECURITY DEFINER function.
-- ═══════════════════════════════════════════════════════════════
ALTER FUNCTION public.get_unread_counts(p_user_id uuid)
  SET search_path = public, pg_temp;

-- ═══════════════════════════════════════════════════════════════
-- Phase 1B: Revoke EXECUTE on trigger/internal functions from
--           anon and authenticated (and PUBLIC where applicable)
-- ---------------------------------------------------------------
-- Why safe: trigger functions have return type = trigger.
-- PostgreSQL fires them via the trigger mechanism (as the table
-- owner / postgres role), NOT via the calling session's role.
-- Revoking EXECUTE from anon/authenticated therefore has ZERO
-- effect on trigger behaviour. It merely closes the theoretical
-- RPC attack surface where a client could call these functions
-- directly (which would fail anyway due to wrong return type,
-- but defence-in-depth is the principle here).
-- ═══════════════════════════════════════════════════════════════

-- Channel triggers
REVOKE EXECUTE ON FUNCTION public.ch_update_channel_last_message()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.ch_update_member_count()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.update_channel_last_message()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.update_channel_member_count()
  FROM anon, authenticated;

-- Conversation trigger (already had correct search_path)
REVOKE EXECUTE ON FUNCTION public.update_conversation_last_message()
  FROM anon, authenticated;

-- Presence trigger — also has PUBLIC grant, revoke that too
REVOKE EXECUTE ON FUNCTION public.handle_new_user_presence()
  FROM PUBLIC, anon, authenticated;

-- Calendar triggers
REVOKE EXECUTE ON FUNCTION public.create_default_calendars_for_user()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_personal_calendar_for_user()
  FROM anon, authenticated;

-- Internal DDL helper — also has PUBLIC grant, revoke that too
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
  FROM PUBLIC, anon, authenticated;
