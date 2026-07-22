/*
# Close password recovery runtime confirmation bypass

Remove the old RPC bypass path so the only way to set
phone_password_recovery_secret_operator_confirmed=true
is via the check-phone-password-reset-runtime edge function.
*/

-- Revoke all access from every role first
REVOKE ALL ON FUNCTION public.confirm_phone_password_recovery_secret()
FROM PUBLIC, anon, authenticated, service_role;

-- Drop the function entirely — no public path to true the config remains
DROP FUNCTION IF EXISTS public.confirm_phone_password_recovery_secret();
