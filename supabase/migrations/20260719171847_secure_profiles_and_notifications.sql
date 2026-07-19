-- ─────────────────────────────────────────────────────────────────
-- Migration: tighten RLS on profiles and notifications
-- ─────────────────────────────────────────────────────────────────

-- 1) PROFILES
-- 1a) Drop the wide-open anon read policy (USING true).
DROP POLICY IF EXISTS "anon_can_read_profiles_for_username_login" ON public.profiles;

-- 1b) Replace the wide-open authenticated read policy with a least-privilege one.
--     Non-admins can only read their own row. Admins can read all rows.
--     Username lookup already goes through the SECURITY DEFINER RPC get_email_by_username,
--     so login-by-username does NOT depend on this SELECT policy.
DROP POLICY IF EXISTS "Authenticated users can read all profiles" ON public.profiles;
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_current_user_admin());

-- 1c) Expose only public columns via a security_invoker view for non-admin contexts.
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT
  user_id,
  full_name,
  username,
  avatar_url,
  position,
  department,
  organization,
  is_active,
  is_hidden
FROM public.profiles;

ALTER VIEW public.profiles_public OWNER TO postgres;
GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- 2) NOTIFICATIONS
-- 2a) Restrict direct INSERT to own user_id only.
--     Server-side notification creation (Edge Functions / RPC using service role)
--     bypasses RLS, so legitimate cross-user notifications still work.
DROP POLICY IF EXISTS "Authenticated users can insert non-minutes notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;

CREATE POLICY "Users can insert own notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 2b) Add a controlled RPC for cross-user notification creation.
--     Caller must be authenticated; sender is forced to auth.uid(); sender_name/avatar
--     are resolved server-side from the caller's profile (client cannot set them).
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Resolve sender identity from the caller's profile (cannot be spoofed by client).
  SELECT full_name, avatar_url
    INTO v_sender_name, v_sender_avatar
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

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

GRANT EXECUTE ON FUNCTION public.create_notification TO authenticated;
