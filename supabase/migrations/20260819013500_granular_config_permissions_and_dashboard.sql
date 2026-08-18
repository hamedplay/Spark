-- Granular configuration permissions and secure management-dashboard bridge.
-- Existing migrations are intentionally not modified.

CREATE OR REPLACE FUNCTION private.current_user_has_permission_v1(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_key IS NULL OR btrim(p_key) = '' THEN
    RETURN false;
  END IF;
  IF NOT private.is_current_session_fully_authorized() THEN
    RETURN false;
  END IF;
  IF private.is_current_user_admin() THEN
    RETURN true;
  END IF;
  RETURN public._has_permission(v_user_id, p_key);
END;
$$;
REVOKE ALL ON FUNCTION private.current_user_has_permission_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_user_has_permission_v1(text) TO authenticated, service_role;

-- Preserve intended access from legacy coarse config permissions without auto-granting
-- the three new rights-administration permissions.
UPDATE public.user_groups SET permissions = permissions || '{"config_platform.general":true,"config_platform.appearance":true,"config_platform.regional":true,"config_platform.ui_settings":true}'::jsonb WHERE permissions @> '{"config_platform":true}'::jsonb;
UPDATE public.user_groups SET permissions = permissions || '{"config_users.users_list":true,"config_users.users_online":true,"config_users.user_groups":true,"config_users.group_events":true,"config_users.org_structure":true}'::jsonb WHERE permissions @> '{"config_users":true}'::jsonb;
UPDATE public.user_groups SET permissions = permissions || '{"config_access.security":true,"config_access.server":true}'::jsonb WHERE permissions @> '{"config_access":true}'::jsonb;
UPDATE public.user_groups SET permissions = permissions || '{"config_audit.audit_log":true}'::jsonb WHERE permissions @> '{"config_audit":true}'::jsonb;
UPDATE public.user_groups SET permissions = permissions || '{"config_notifications.notifications":true,"config_notifications.sms":true,"config_notifications.social_notifications":true,"config_notifications.email":true,"config_notifications.daily_report":true}'::jsonb WHERE permissions @> '{"config_notifications":true}'::jsonb;
UPDATE public.user_groups SET permissions = permissions || '{"config_modules.video_conference":true,"config_modules.calendar":true,"config_modules.minutes_config":true,"config_modules.monitoring":true}'::jsonb WHERE permissions @> '{"config_modules":true}'::jsonb;
UPDATE public.user_groups SET permissions = permissions || '{"config_spark.spark_config":true}'::jsonb WHERE permissions @> '{"config_spark":true}'::jsonb;

-- Dedicated view policies for delegated configuration pages.
DROP POLICY IF EXISTS config_permission_profiles_select ON public.profiles;
CREATE POLICY config_permission_profiles_select ON public.profiles FOR SELECT TO authenticated USING (
  private.current_user_has_permission_v1('config_users.users_list') OR
  private.current_user_has_permission_v1('config_users.users_online') OR
  private.current_user_has_permission_v1('config_users.user_groups') OR
  private.current_user_has_permission_v1('config_users.org_structure') OR
  private.current_user_has_permission_v1('config_users.users_list.permissions') OR
  private.current_user_has_permission_v1('config_users.user_groups.permissions') OR
  private.current_user_has_permission_v1('config_users.org_structure.permissions')
);
DROP POLICY IF EXISTS config_permission_user_groups_select ON public.user_groups;
CREATE POLICY config_permission_user_groups_select ON public.user_groups FOR SELECT TO authenticated USING (
  private.current_user_has_permission_v1('config_users.user_groups') OR
  private.current_user_has_permission_v1('config_users.users_list.permissions') OR
  private.current_user_has_permission_v1('config_users.user_groups.permissions')
);
DROP POLICY IF EXISTS config_permission_user_group_members_select ON public.user_group_members;
CREATE POLICY config_permission_user_group_members_select ON public.user_group_members FOR SELECT TO authenticated USING (
  private.current_user_has_permission_v1('config_users.user_groups') OR
  private.current_user_has_permission_v1('config_users.users_list.permissions') OR
  private.current_user_has_permission_v1('config_users.user_groups.permissions')
);
DROP POLICY IF EXISTS config_permission_user_group_members_insert ON public.user_group_members;
CREATE POLICY config_permission_user_group_members_insert ON public.user_group_members FOR INSERT TO authenticated WITH CHECK (
  private.current_user_has_permission_v1('config_users.users_list.permissions') OR
  private.current_user_has_permission_v1('config_users.user_groups.permissions')
);
DROP POLICY IF EXISTS config_permission_user_group_members_delete ON public.user_group_members;
CREATE POLICY config_permission_user_group_members_delete ON public.user_group_members FOR DELETE TO authenticated USING (
  private.current_user_has_permission_v1('config_users.users_list.permissions') OR
  private.current_user_has_permission_v1('config_users.user_groups.permissions')
);

DROP POLICY IF EXISTS config_permission_org_level_insert ON public.org_level_permissions;
CREATE POLICY config_permission_org_level_insert ON public.org_level_permissions FOR INSERT TO authenticated WITH CHECK (private.current_user_has_permission_v1('config_users.org_structure.permissions'));
DROP POLICY IF EXISTS config_permission_org_level_update ON public.org_level_permissions;
CREATE POLICY config_permission_org_level_update ON public.org_level_permissions FOR UPDATE TO authenticated USING (private.current_user_has_permission_v1('config_users.org_structure.permissions')) WITH CHECK (private.current_user_has_permission_v1('config_users.org_structure.permissions'));
DROP POLICY IF EXISTS config_permission_org_level_delete ON public.org_level_permissions;
CREATE POLICY config_permission_org_level_delete ON public.org_level_permissions FOR DELETE TO authenticated USING (private.current_user_has_permission_v1('config_users.org_structure.permissions'));
DROP POLICY IF EXISTS config_permission_org_position_insert ON public.org_position_permissions;
CREATE POLICY config_permission_org_position_insert ON public.org_position_permissions FOR INSERT TO authenticated WITH CHECK (private.current_user_has_permission_v1('config_users.org_structure.permissions'));
DROP POLICY IF EXISTS config_permission_org_position_update ON public.org_position_permissions;
CREATE POLICY config_permission_org_position_update ON public.org_position_permissions FOR UPDATE TO authenticated USING (private.current_user_has_permission_v1('config_users.org_structure.permissions')) WITH CHECK (private.current_user_has_permission_v1('config_users.org_structure.permissions'));
DROP POLICY IF EXISTS config_permission_org_position_delete ON public.org_position_permissions;
CREATE POLICY config_permission_org_position_delete ON public.org_position_permissions FOR DELETE TO authenticated USING (private.current_user_has_permission_v1('config_users.org_structure.permissions'));

-- System-config sections can be managed only through their exact page permission.
CREATE OR REPLACE FUNCTION private.config_permission_for_system_section_v1(p_section text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_section
    WHEN 'general' THEN 'config_platform.general'
    WHEN 'appearance' THEN 'config_platform.appearance'
    WHEN 'regional' THEN 'config_platform.regional'
    WHEN 'ui' THEN 'config_platform.ui_settings'
    WHEN 'security' THEN 'config_access.security'
    WHEN 'server' THEN 'config_access.server'
    WHEN 'email' THEN 'config_notifications.email'
    WHEN 'video_conference' THEN 'config_modules.video_conference'
    WHEN 'calendar' THEN 'config_modules.calendar'
    WHEN 'minutes' THEN 'config_modules.minutes_config'
    WHEN 'spark' THEN 'config_spark.spark_config'
    ELSE NULL
  END
$$;
REVOKE ALL ON FUNCTION private.config_permission_for_system_section_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.config_permission_for_system_section_v1(text) TO authenticated, service_role;
DROP POLICY IF EXISTS config_permission_system_config_select ON public.system_config;
CREATE POLICY config_permission_system_config_select ON public.system_config FOR SELECT TO authenticated USING (private.current_user_has_permission_v1(private.config_permission_for_system_section_v1(section)));
DROP POLICY IF EXISTS config_permission_system_config_insert ON public.system_config;
CREATE POLICY config_permission_system_config_insert ON public.system_config FOR INSERT TO authenticated WITH CHECK (private.current_user_has_permission_v1(private.config_permission_for_system_section_v1(section)));
DROP POLICY IF EXISTS config_permission_system_config_update ON public.system_config;
CREATE POLICY config_permission_system_config_update ON public.system_config FOR UPDATE TO authenticated USING (private.current_user_has_permission_v1(private.config_permission_for_system_section_v1(section))) WITH CHECK (private.current_user_has_permission_v1(private.config_permission_for_system_section_v1(section)));
DROP POLICY IF EXISTS config_permission_system_config_delete ON public.system_config;
CREATE POLICY config_permission_system_config_delete ON public.system_config FOR DELETE TO authenticated USING (private.current_user_has_permission_v1(private.config_permission_for_system_section_v1(section)));

-- Common specialized configuration tables.
DROP POLICY IF EXISTS config_permission_notification_group_rules_all ON public.notification_group_rules;
CREATE POLICY config_permission_notification_group_rules_all ON public.notification_group_rules FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.notifications')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.notifications'));
DROP POLICY IF EXISTS config_permission_notification_templates_all ON public.notification_templates;
CREATE POLICY config_permission_notification_templates_all ON public.notification_templates FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.notifications')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.notifications'));
DROP POLICY IF EXISTS config_permission_notifications_select ON public.notifications;
CREATE POLICY config_permission_notifications_select ON public.notifications FOR SELECT TO authenticated USING (private.current_user_has_permission_v1('config_notifications.notifications'));
DROP POLICY IF EXISTS config_permission_sms_providers_all ON public.sms_providers;
CREATE POLICY config_permission_sms_providers_all ON public.sms_providers FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.sms')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.sms'));
DROP POLICY IF EXISTS config_permission_sms_templates_all ON public.sms_templates;
CREATE POLICY config_permission_sms_templates_all ON public.sms_templates FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.sms')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.sms'));
DROP POLICY IF EXISTS config_permission_sms_group_rules_all ON public.sms_group_rules;
CREATE POLICY config_permission_sms_group_rules_all ON public.sms_group_rules FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.sms')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.sms'));
DROP POLICY IF EXISTS config_permission_sms_logs_select ON public.sms_dispatch_logs;
CREATE POLICY config_permission_sms_logs_select ON public.sms_dispatch_logs FOR SELECT TO authenticated USING (private.current_user_has_permission_v1('config_notifications.sms'));
DROP POLICY IF EXISTS config_permission_social_channels_all ON public.social_channel_configs;
CREATE POLICY config_permission_social_channels_all ON public.social_channel_configs FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.social_notifications')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.social_notifications'));
DROP POLICY IF EXISTS config_permission_daily_report_all ON public.daily_report_config;
CREATE POLICY config_permission_daily_report_all ON public.daily_report_config FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.daily_report')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.daily_report'));
DROP POLICY IF EXISTS config_permission_calendar_occasions_all ON public.calendar_occasions;
CREATE POLICY config_permission_calendar_occasions_all ON public.calendar_occasions FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_modules.calendar')) WITH CHECK (private.current_user_has_permission_v1('config_modules.calendar'));
DROP POLICY IF EXISTS config_permission_audit_log_select ON public.audit_log;
CREATE POLICY config_permission_audit_log_select ON public.audit_log FOR SELECT TO authenticated USING (private.current_user_has_permission_v1('config_audit.audit_log'));
DROP POLICY IF EXISTS config_permission_security_audit_select ON public.security_audit_events;
CREATE POLICY config_permission_security_audit_select ON public.security_audit_events FOR SELECT TO authenticated USING (private.current_user_has_permission_v1('config_audit.audit_log'));
DROP POLICY IF EXISTS config_permission_spark_config_all ON public.spark_config;
CREATE POLICY config_permission_spark_config_all ON public.spark_config FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_spark.spark_config')) WITH CHECK (private.current_user_has_permission_v1('config_spark.spark_config'));
DROP POLICY IF EXISTS config_permission_spark_ai_settings_all ON public.spark_ai_settings;
CREATE POLICY config_permission_spark_ai_settings_all ON public.spark_ai_settings FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_spark.spark_config')) WITH CHECK (private.current_user_has_permission_v1('config_spark.spark_config'));
DROP POLICY IF EXISTS config_permission_spark_keywords_all ON public.spark_field_keywords;
CREATE POLICY config_permission_spark_keywords_all ON public.spark_field_keywords FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_spark.spark_config')) WITH CHECK (private.current_user_has_permission_v1('config_spark.spark_config'));

-- Portal assets are writable only by the two config pages that own them.
DROP POLICY IF EXISTS config_permission_portal_assets_insert ON storage.objects;
CREATE POLICY config_permission_portal_assets_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'portal-assets' AND (
    private.current_user_has_permission_v1('config_platform.appearance') OR
    private.current_user_has_permission_v1('config_modules.minutes_config')
  )
);
DROP POLICY IF EXISTS config_permission_portal_assets_update ON storage.objects;
CREATE POLICY config_permission_portal_assets_update ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'portal-assets' AND (
    private.current_user_has_permission_v1('config_platform.appearance') OR
    private.current_user_has_permission_v1('config_modules.minutes_config')
  )
) WITH CHECK (
  bucket_id = 'portal-assets' AND (
    private.current_user_has_permission_v1('config_platform.appearance') OR
    private.current_user_has_permission_v1('config_modules.minutes_config')
  )
);
DROP POLICY IF EXISTS config_permission_portal_assets_delete ON storage.objects;
CREATE POLICY config_permission_portal_assets_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'portal-assets' AND (
    private.current_user_has_permission_v1('config_platform.appearance') OR
    private.current_user_has_permission_v1('config_modules.minutes_config')
  )
);

-- Allow the dedicated group-rights RPC to be delegated without exposing a SECURITY DEFINER function in public.
CREATE OR REPLACE FUNCTION private.admin_update_user_group_permissions_impl(p_group_id uuid, p_permissions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_admin boolean := false;
  v_group_name text;
  v_group_display_name text;
  v_is_system boolean;
  v_saved_permissions jsonb;
  v_permission_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF NOT private.is_current_session_fully_authorized() THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_ACCESS_RESTRICTED'); END IF;
  SELECT COALESCE(p.is_admin, false) INTO v_is_admin FROM public.profiles p WHERE p.user_id = v_user_id AND p.account_status = 'ACTIVE' LIMIT 1;
  IF NOT COALESCE(v_is_admin, false) AND NOT private.current_user_has_permission_v1('config_users.user_groups.permissions') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PERMISSION_REQUIRED');
  END IF;
  IF p_group_id IS NULL OR p_permissions IS NULL OR jsonb_typeof(p_permissions) <> 'object' THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PERMISSIONS'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_permissions) e WHERE jsonb_typeof(e.value) <> 'boolean') THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PERMISSION_VALUE'); END IF;
  UPDATE public.user_groups g SET permissions = p_permissions WHERE g.id = p_group_id
    RETURNING g.name, g.display_name, COALESCE(g.is_system, false), g.permissions INTO v_group_name, v_group_display_name, v_is_system, v_saved_permissions;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'GROUP_NOT_FOUND'); END IF;
  SELECT count(*)::integer INTO v_permission_count FROM jsonb_object_keys(v_saved_permissions);
  BEGIN
    INSERT INTO public.security_audit_events (user_id,event_type,event_category,severity,result,metadata)
    VALUES (v_user_id,'user_group_permissions_updated','settings_change','info','success',jsonb_build_object('group_id',p_group_id,'group_name',v_group_name,'group_display_name',v_group_display_name,'is_system',v_is_system,'permission_count',v_permission_count));
  EXCEPTION WHEN others THEN NULL;
  END;
  RETURN jsonb_build_object('ok',true,'group_id',p_group_id,'is_system',v_is_system,'permissions',v_saved_permissions);
END;
$$;
REVOKE ALL ON FUNCTION private.admin_update_user_group_permissions_impl(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.admin_update_user_group_permissions_impl(uuid, jsonb) TO authenticated, service_role;

-- Preserve the hardened SECURITY DEFINER dashboard: browser roles still cannot execute it.
-- The Edge Function authenticates the caller, then service_role invokes this SECURITY INVOKER bridge.
CREATE OR REPLACE FUNCTION public.get_management_dashboard_for_user_v1(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'INVALID_USER_ID'; END IF;
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  RETURN public.get_management_dashboard_v1();
END;
$$;
REVOKE ALL ON FUNCTION public.get_management_dashboard_for_user_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_management_dashboard_for_user_v1(uuid) TO service_role;
