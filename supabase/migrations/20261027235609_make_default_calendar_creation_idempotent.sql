-- Keep user-created calendars and renamed defaults. Serialize calls per user;
-- ON CONFLICT(id) alone never prevented duplicates with newly generated UUIDs.
CREATE OR REPLACE FUNCTION public.ensure_default_calendars_for_user(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_profile record;
  v_name text;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  -- Lifecycle RPCs already lock this row. Reentrant acquisition is safe and
  -- parallel ensure calls wait before inspecting/creating the same calendars.
  SELECT user_id,full_name,email,account_status,is_active INTO v_profile
  FROM public.profiles WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.account_status IS DISTINCT FROM 'ACTIVE'
    OR v_profile.is_active IS NOT TRUE THEN RETURN; END IF;

  v_name:=coalesce(nullif(btrim(v_profile.full_name),''),
    nullif(split_part(coalesce(v_profile.email,''),'@',1),''),'کاربر');

  INSERT INTO public.calendars(user_id,name,type,color,is_active,
    enable_reminder,enable_overlap,is_occasions,is_personal_public)
  SELECT p_user_id,v_name,'private','#3b82f6',true,true,false,false,false
  WHERE NOT EXISTS(
    SELECT FROM public.calendars WHERE user_id=p_user_id AND type='private'
      AND coalesce(is_occasions,false)=false
      AND coalesce(is_personal_public,false)=false
  );

  INSERT INTO public.calendars(user_id,name,type,color,is_active,
    enable_reminder,enable_overlap,is_occasions,is_personal_public)
  SELECT p_user_id,v_name||' (عمومی)','public','#10b981',true,false,true,false,true
  WHERE NOT EXISTS(
    SELECT FROM public.calendars WHERE user_id=p_user_id AND type='public'
      AND is_personal_public IS TRUE AND coalesce(is_occasions,false)=false
  );
END $function$;
REVOKE EXECUTE ON FUNCTION public.ensure_default_calendars_for_user(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_default_calendars_for_user(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
