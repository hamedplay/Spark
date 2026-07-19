-- Close gaps in the profile-field guard trigger:
--   1. telegram_chat_id was fully unprotected after the previous fix.
--      A non-admin user could set an arbitrary non-null chat_id. Now only
--      nulling an existing value (disconnect) is allowed; the backend
--      (telegram-webhook, service role) still sets the initial value.
--   2. primary_position_id / primary_unit_id (org-authoritative) were
--      unprotected — a user could self-assign org positions.
--   3. avatar_storage_path / avatar_url are backend-managed (written by
--      complete_avatar_job RPC under service role). Now protected from
--      direct user writes.
--   4. username is set once at signup (AuthPage) then immutable in UI.
--      Allow the initial set (OLD IS NULL), block later changes.
--   5. position / department are admin-managed display fields (PortalConfig
--      / UserManagementPanel). Now protected from direct user writes.
-- Admin (is_current_user_admin) and backend (auth.uid() IS NULL) bypass
-- unchanged. IS DISTINCT FROM keeps unchanged-value sends allowed.

CREATE OR REPLACE FUNCTION public.guard_protected_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_current_user_admin() THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
       OR NEW.can_broadcast IS DISTINCT FROM OLD.can_broadcast
       OR NEW.organization IS DISTINCT FROM OLD.organization
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.is_hidden IS DISTINCT FROM OLD.is_hidden
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.telegram_token IS DISTINCT FROM OLD.telegram_token
       OR NEW.webhook_url IS DISTINCT FROM OLD.webhook_url
       OR NEW.google_calendar_token IS DISTINCT FROM OLD.google_calendar_token
       OR NEW.primary_position_id IS DISTINCT FROM OLD.primary_position_id
       OR NEW.primary_unit_id IS DISTINCT FROM OLD.primary_unit_id
       OR NEW.avatar_storage_path IS DISTINCT FROM OLD.avatar_storage_path
       OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
       OR NEW.position IS DISTINCT FROM OLD.position
       OR NEW.department IS DISTINCT FROM OLD.department
       OR (NEW.username IS DISTINCT FROM OLD.username
           AND NOT (OLD.username IS NULL AND NEW.username IS NOT NULL))
       OR (NEW.telegram_chat_id IS DISTINCT FROM OLD.telegram_chat_id
           AND NOT (OLD.telegram_chat_id IS NOT NULL AND NEW.telegram_chat_id IS NULL))
    THEN
      RAISE EXCEPTION 'Not allowed to modify protected profile fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Trigger functions don't need direct EXECUTE; the trigger fires regardless.
REVOKE EXECUTE ON FUNCTION public.guard_protected_profile_fields() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_protected_profile_fields() FROM anon;
REVOKE EXECUTE ON FUNCTION public.guard_protected_profile_fields() FROM authenticated;
