-- ═══════════════════════════════════════════════════════════════════
-- Step 1: get_sms_dispatch_info — restore authenticated + add guard
-- ---------------------------------------------------------------
-- Caller matrix:
--   service_role (Edge Function / cron):  auth.uid() = NULL → bypass
--   authenticated admin:                  auth.uid() IS NOT NULL, is_admin → allow
--   authenticated non-admin self:         auth.uid() = target_user_id → allow
--   authenticated non-admin cross-user:   RAISE EXCEPTION 'Not authorized'
--
-- NOTE: this breaks the current client-side notification path where
-- a non-admin user (meeting organizer) calls this for a participant.
-- That flow must be routed through an Edge Function (service_role).
-- ═══════════════════════════════════════════════════════════════════

-- Restore the grant revoked in Phase 3-B
GRANT EXECUTE ON FUNCTION public.get_sms_dispatch_info(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_sms_dispatch_info(
  target_user_id uuid,
  p_category     text
)
RETURNS TABLE(provider_id uuid, phone text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- service_role caller: auth.uid() IS NULL → bypass (Edge Function / cron)
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> target_user_id
     AND NOT public.is_current_user_admin()
  THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT sgr.provider_id, pr.phone
  FROM user_group_members ugm
  JOIN sms_group_rules sgr ON sgr.group_id = ugm.group_id
  JOIN profiles        pr  ON pr.user_id   = target_user_id
  WHERE ugm.user_id       = target_user_id
    AND sgr.sms_category  = p_category
    AND sgr.enabled       = true
  LIMIT 1;
END;
$$;
