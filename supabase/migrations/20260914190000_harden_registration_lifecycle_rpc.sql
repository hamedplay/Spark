-- Account lifecycle mutations are service-only and are reached through the
-- authenticated admin-user-lifecycle Edge Function. Do not expose the service
-- RPC directly to browser roles.
REVOKE ALL ON FUNCTION private.admin_set_user_lifecycle_service(uuid, uuid, uuid, text, bigint, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_user_lifecycle_service(uuid, uuid, uuid, text, bigint, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.admin_set_user_lifecycle_service(uuid, uuid, uuid, text, bigint, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_lifecycle_service(uuid, uuid, uuid, text, bigint, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
