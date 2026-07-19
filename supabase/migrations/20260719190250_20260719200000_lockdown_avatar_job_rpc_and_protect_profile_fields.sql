-- Fix three security issues found in the admin avatar upload review:
--   1. create_avatar_job RPC was executable by anon/authenticated (any client
--      could create a job with arbitrary user_id / quarantine_path).
--   2. Non-admin authenticated users could change is_admin, organization,
--      is_active, is_hidden and other protected columns on their own profile
--      row via the "Users can update own profile" RLS policy.
--   3. Admins could not poll avatar_jobs belonging to a target user (only
--      select_own_avatar_jobs existed), breaking the admin upload flow.

-- ── 1. Lock down create_avatar_job: only service_role may execute ───────────
REVOKE EXECUTE ON FUNCTION public.create_avatar_job(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_avatar_job(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_avatar_job(uuid, text) FROM authenticated;

-- ── 2. Trigger: prevent non-admin users from changing protected fields ──────
-- Allows service_role (auth.uid() IS NULL) and admins to update anything.
-- Non-admin authenticated users may still update their own non-protected
-- fields; only *changes* to protected fields are blocked (IS NOT DISTINCT
-- FROM lets no-op updates through, so frontend code that sends the full
-- profile object continues to work).
CREATE OR REPLACE FUNCTION public.guard_protected_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_current_user_admin() THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
       OR NEW.organization IS DISTINCT FROM OLD.organization
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.is_hidden IS DISTINCT FROM OLD.is_hidden
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.telegram_token IS DISTINCT FROM OLD.telegram_token
       OR NEW.telegram_chat_id IS DISTINCT FROM OLD.telegram_chat_id
       OR NEW.webhook_url IS DISTINCT FROM OLD.webhook_url
       OR NEW.google_calendar_token IS DISTINCT FROM OLD.google_calendar_token
    THEN
      RAISE EXCEPTION 'Not allowed to modify protected profile fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_protected_profile_fields ON public.profiles;
CREATE TRIGGER trg_guard_protected_profile_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_protected_profile_fields();

-- ── 3. Allow admins to SELECT avatar_jobs for target-user polling ───────────
CREATE POLICY "admins_can_read_avatar_jobs" ON public.avatar_jobs
  FOR SELECT TO authenticated
  USING (public.is_current_user_admin());
