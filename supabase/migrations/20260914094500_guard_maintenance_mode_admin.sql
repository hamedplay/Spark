-- maintenance_mode is enforced by the authenticated app with an is_admin bypass.
-- Keep read access available for runtime/config visibility, but only an actual
-- application admin may create, update or delete this switch.

DROP POLICY IF EXISTS system_config_maintenance_admin_insert ON public.system_config;
CREATE POLICY system_config_maintenance_admin_insert
ON public.system_config
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  NOT (section = 'security' AND key = 'maintenance_mode')
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_admin IS TRUE
      AND p.is_active IS TRUE
      AND p.account_status = 'ACTIVE'
  )
);

DROP POLICY IF EXISTS system_config_maintenance_admin_update ON public.system_config;
CREATE POLICY system_config_maintenance_admin_update
ON public.system_config
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  NOT (section = 'security' AND key = 'maintenance_mode')
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_admin IS TRUE
      AND p.is_active IS TRUE
      AND p.account_status = 'ACTIVE'
  )
)
WITH CHECK (
  NOT (section = 'security' AND key = 'maintenance_mode')
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_admin IS TRUE
      AND p.is_active IS TRUE
      AND p.account_status = 'ACTIVE'
  )
);

DROP POLICY IF EXISTS system_config_maintenance_admin_delete ON public.system_config;
CREATE POLICY system_config_maintenance_admin_delete
ON public.system_config
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
  NOT (section = 'security' AND key = 'maintenance_mode')
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_admin IS TRUE
      AND p.is_active IS TRUE
      AND p.account_status = 'ACTIVE'
  )
);
