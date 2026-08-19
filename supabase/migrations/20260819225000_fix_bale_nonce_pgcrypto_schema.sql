create or replace function public.create_bale_link_nonce_service(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nonce text;
  v_nonce_hash text;
  v_expires_at timestamptz := now() + interval '10 minutes';
begin
  if p_user_id is null or not exists (
    select 1 from auth.users u where u.id = p_user_id
  ) then
    raise exception 'INVALID_USER';
  end if;

  v_nonce := encode(extensions.gen_random_bytes(32), 'hex');
  v_nonce_hash := private.bale_link_hmac_v1(v_nonce, 'bale_link');

  insert into public.bale_link_nonces (
    nonce_hash,
    user_id,
    expires_at
  ) values (
    v_nonce_hash,
    p_user_id,
    v_expires_at
  );

  return jsonb_build_object(
    'ok', true,
    'nonce', v_nonce,
    'expires_at', v_expires_at
  );
end;
$$;

revoke all on function public.create_bale_link_nonce_service(uuid) from public, anon, authenticated;
grant execute on function public.create_bale_link_nonce_service(uuid) to service_role;
