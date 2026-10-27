create or replace function private.get_my_pwa_push_config()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_access jsonb; v_public text;
begin
 v_access := private.get_my_auth_access_state();
 if auth.uid() is null or v_access->>'access_level' is distinct from 'FULL' then
  raise exception 'AUTH_ACCESS_RESTRICTED' using errcode='42501';
 end if;
 v_public := nullif(private.safe_vault_secret('pwa_vapid_public_key'),'');
 if v_public is null or nullif(private.safe_vault_secret('pwa_vapid_private_key'),'') is null then
  raise exception 'PWA_PUSH_NOT_CONFIGURED' using errcode='P0001';
 end if;
 return jsonb_build_object('publicKey',v_public);
end $$;
revoke all on function private.get_my_pwa_push_config() from public,anon;
grant execute on function private.get_my_pwa_push_config() to authenticated;
create or replace function public.get_my_pwa_push_config()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.get_my_pwa_push_config() $$;
revoke all on function public.get_my_pwa_push_config() from public,anon;
grant execute on function public.get_my_pwa_push_config() to authenticated;
