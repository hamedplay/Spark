-- ============================================================================
-- Migration: minutes_phase1_hardening
-- Description: Two targeted hardening measures for Minutes Phase 1:
--              1. REVOKE EXECUTE FROM anon on all three Minutes functions
--              2. Add updated_at auto-maintenance trigger to all four tables
-- No changes to existing policies, tables, triggers, or frontend
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. REVOKE EXECUTE FROM anon on Minutes functions
--    Removes default Supabase anon access. authenticated and service_role
--    grants are NOT touched.
-- ----------------------------------------------------------------------------

-- 1.1 Helper function: can_create_minutes_for_meeting
REVOKE EXECUTE ON FUNCTION public.can_create_minutes_for_meeting(uuid)
    FROM anon;

-- 1.2 Helper function: can_view_restricted_minutes_meeting
REVOKE EXECUTE ON FUNCTION public.can_view_restricted_minutes_meeting(uuid)
    FROM anon;

-- 1.3 Trigger function: check_minutes_immutable_fields
REVOKE EXECUTE ON FUNCTION public.check_minutes_immutable_fields()
    FROM anon;

-- ----------------------------------------------------------------------------
-- 2. Trigger Function: minutes_set_updated_at
--    NOT SECURITY DEFINER — runs as invoking user
--    Sets NEW.updated_at = now() on every UPDATE
--    Shared across all four Minutes tables
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.minutes_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Lock down: no direct execution by anyone — only invoked by trigger engine
REVOKE ALL ON FUNCTION public.minutes_set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.minutes_set_updated_at() FROM anon;

-- ----------------------------------------------------------------------------
-- 3. Triggers: BEFORE UPDATE FOR EACH ROW on all four Minutes tables
--    Names are unique and descriptive
-- ----------------------------------------------------------------------------

-- 3.1 public.minutes
CREATE TRIGGER minutes_set_updated_at
    BEFORE UPDATE ON public.minutes
    FOR EACH ROW
    EXECUTE FUNCTION public.minutes_set_updated_at();

-- 3.2 public.minutes_participants
CREATE TRIGGER minutes_participants_set_updated_at
    BEFORE UPDATE ON public.minutes_participants
    FOR EACH ROW
    EXECUTE FUNCTION public.minutes_set_updated_at();

-- 3.3 public.minutes_external_participants
CREATE TRIGGER minutes_external_participants_set_updated_at
    BEFORE UPDATE ON public.minutes_external_participants
    FOR EACH ROW
    EXECUTE FUNCTION public.minutes_set_updated_at();

-- 3.4 public.minutes_agenda_results
CREATE TRIGGER minutes_agenda_results_set_updated_at
    BEFORE UPDATE ON public.minutes_agenda_results
    FOR EACH ROW
    EXECUTE FUNCTION public.minutes_set_updated_at();
