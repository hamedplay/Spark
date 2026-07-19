-- Fix regressions and gaps in the profile-field guard trigger:
--   1. telegram_chat_id was protected, breaking the user's Telegram
--      disconnect flow (legitimate set-to-NULL by the owner). It is the
--      user's own notification destination, not a privilege field — the
--      secure linking path runs via the telegram-link-generate Edge
--      Function with the service role.
--   2. can_broadcast (a privilege flag) was missing from the protected
--      list, allowing a non-admin user to self-promote broadcast rights.

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
    THEN
      RAISE EXCEPTION 'Not allowed to modify protected profile fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
