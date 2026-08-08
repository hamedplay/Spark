/* Restrict Custom MFA RPC execution to intended roles. */
REVOKE ALL ON FUNCTION public.create_bale_link_nonce() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_custom_mfa_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_custom_mfa_challenge(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_custom_mfa_recovery(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.regenerate_custom_mfa_recovery_codes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_bale_link_nonce() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_custom_mfa_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_custom_mfa_challenge(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_custom_mfa_recovery(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_custom_mfa_recovery_codes() TO authenticated;
