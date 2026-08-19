-- Ensure SMS group rules never force dispatch through an inactive provider.
-- If a rule points to an inactive/missing provider, return NULL so the
-- send-sms dispatcher falls back to the active default provider.

CREATE OR REPLACE FUNCTION public.get_sms_dispatch_info(
  target_user_id uuid,
  p_category text
)
RETURNS TABLE(provider_id uuid, phone text)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- service_role caller: auth.uid() IS NULL -> bypass (Edge Function / cron)
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> target_user_id
     AND NOT public.is_current_user_admin()
  THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN sp.is_active IS TRUE THEN sgr.provider_id
      ELSE NULL::uuid
    END AS provider_id,
    pr.phone
  FROM public.user_group_members ugm
  JOIN public.sms_group_rules sgr
    ON sgr.group_id = ugm.group_id
  JOIN public.profiles pr
    ON pr.user_id = target_user_id
  LEFT JOIN public.sms_providers sp
    ON sp.id = sgr.provider_id
  WHERE ugm.user_id = target_user_id
    AND sgr.sms_category = p_category
    AND sgr.enabled = true
  LIMIT 1;
END;
$function$;
