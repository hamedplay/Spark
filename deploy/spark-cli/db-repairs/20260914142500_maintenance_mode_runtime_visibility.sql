BEGIN;

-- maintenance_mode is an operational boolean consumed by every authenticated
-- shell. It is not secret configuration. Grant only this single security row
-- to authenticated users so the runtime maintenance gate and Realtime RLS can
-- observe it without exposing the rest of the security section.
DROP POLICY IF EXISTS system_config_authenticated_read_maintenance_mode
  ON public.system_config;

CREATE POLICY system_config_authenticated_read_maintenance_mode
ON public.system_config
FOR SELECT
TO authenticated
USING (
  section = 'security'
  AND key = 'maintenance_mode'
);

NOTIFY pgrst, 'reload schema';

COMMIT;
