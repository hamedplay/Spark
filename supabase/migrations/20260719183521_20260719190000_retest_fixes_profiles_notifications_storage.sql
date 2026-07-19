-- ─────────────────────────────────────────────────────────────────
-- Migration: Security Retest fixes
--   1) profiles_public: enable security_invoker so the view honors
--      underlying profiles RLS instead of running as owner (postgres).
--   2) Revoke excess anon grants on profiles, profiles_public, notifications.
--   3) Tighten create_notification: restrict EXECUTE to authenticated,
--      validate recipient (exists, active, not hidden, same organization)
--      and reject when sender organization is NULL/empty. Sender identity
--      continues to be resolved server-side; signature unchanged.
--   4) Storage: drop legacy write + public-read policies on the `profiles`
--      bucket (new avatars go through avatar-quarantine). Clear broken
--      avatar_url references pointing at the now-empty legacy buckets.
-- ─────────────────────────────────────────────────────────────────

-- 1) PROFILES_PUBLIC — honor RLS of the underlying table (PG15+).
ALTER VIEW public.profiles_public SET (security_invoker = on);

-- Revoke anon read on the view; authenticated retains SELECT but now
-- rows are filtered by profiles RLS (own row or admin).
REVOKE SELECT ON public.profiles_public FROM anon;

-- 2) PROFILES / NOTIFICATIONS — drop excess anon table grants.
REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.notifications FROM anon;

-- 3) CREATE_NOTIFICATION — tighten authorization.
--     Signature and return type are unchanged; search_path stays empty.
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text,
  p_action_url text DEFAULT NULL,
  p_template_category text DEFAULT NULL,
  p_template_event_type text DEFAULT NULL,
  p_template_audience text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_minute_id uuid DEFAULT NULL,
  p_revision_number integer DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL,
  p_event_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_id uuid;
  v_sender_name text;
  v_sender_avatar text;
  v_sender_org text;
  v_recipient_org text;
  v_recipient_active boolean;
  v_recipient_hidden boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Sender identity is resolved server-side (cannot be spoofed by client).
  SELECT full_name, avatar_url, organization
    INTO v_sender_name, v_sender_avatar, v_sender_org
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  -- Sender must have a concrete organization.
  IF v_sender_org IS NULL OR btrim(v_sender_org) = '' THEN
    RAISE EXCEPTION 'sender_organization_required';
  END IF;

  -- Recipient must exist, be active, not hidden, and share the sender's
  -- exact organization. NULL/empty recipient organization is rejected.
  SELECT organization, COALESCE(is_active, false), COALESCE(is_hidden, false)
    INTO v_recipient_org, v_recipient_active, v_recipient_hidden
  FROM public.profiles
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_recipient_org IS NULL OR btrim(v_recipient_org) = '' THEN
    RAISE EXCEPTION 'recipient_not_found';
  END IF;
  IF v_recipient_active IS NOT TRUE THEN
    RAISE EXCEPTION 'recipient_not_active';
  END IF;
  IF v_recipient_hidden IS TRUE THEN
    RAISE EXCEPTION 'recipient_hidden';
  END IF;
  IF v_recipient_org <> v_sender_org THEN
    RAISE EXCEPTION 'recipient_outside_organization';
  END IF;

  INSERT INTO public.notifications (
    user_id, title, message, type, read,
    sender_id, sender_name, sender_avatar_url, action_url,
    template_category, template_event_type, template_audience,
    entity_type, entity_id, minute_id, revision_number, metadata, event_key
  ) VALUES (
    p_user_id, p_title, p_message, p_type, false,
    auth.uid(), v_sender_name, v_sender_avatar, p_action_url,
    p_template_category, p_template_event_type, p_template_audience,
    p_entity_type, p_entity_id, p_minute_id, p_revision_number, p_metadata, p_event_key
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- Revoke EXECUTE from PUBLIC and anon; only authenticated may call.
REVOKE EXECUTE ON FUNCTION public.create_notification FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_notification FROM anon;
GRANT EXECUTE ON FUNCTION public.create_notification TO authenticated;

-- 4) STORAGE — close legacy `profiles` bucket writes and public read.
--    New avatars are uploaded to the private `avatar-quarantine` bucket
--    by the avatar-upload Edge Function; the legacy `profiles` bucket is
--    no longer the authoritative path.
DROP POLICY IF EXISTS "Public read access for avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;

-- Clear broken avatar_url values that reference the now-empty legacy
-- `avatars` and `profiles` storage buckets. Only avatar_url is touched;
-- avatar_storage_path and all other columns are left unchanged.
UPDATE public.profiles
SET avatar_url = NULL
WHERE avatar_url IS NOT NULL
  AND avatar_url <> ''
  AND ( avatar_url ILIKE '%/storage/v1/object/public/avatars/%'
     OR avatar_url ILIKE '%/storage/v1/object/public/profiles/%'
     OR avatar_url ILIKE '%/storage/v1/object/sign/avatars/%'
     OR avatar_url ILIKE '%/storage/v1/object/sign/profiles/%' );
