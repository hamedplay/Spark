
-- Allow all authenticated users to read the spark visibility setting
-- Previously only 'general' and 'appearance' sections were readable by authenticated users

-- Drop the old restricted read policy for authenticated
DROP POLICY IF EXISTS "authenticated_read_system_config" ON system_config;

-- Recreate with spark section included
CREATE POLICY "authenticated_read_system_config" ON system_config
  FOR SELECT TO authenticated
  USING (section = ANY (ARRAY['general', 'appearance', 'spark']));
