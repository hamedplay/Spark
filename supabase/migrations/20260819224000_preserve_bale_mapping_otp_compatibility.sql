-- The current Bale OTP transport still reads the legacy bale_chat_id column.
-- Keep it populated for compatibility while also storing the encrypted/HMAC form.
-- This can be removed only after every Bale sender has migrated to get_bale_chat_id_service().
create or replace function public.consume_bale_link_nonce_service(
  p_nonce text,
  p_bale_chat_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nonce_hash text;
  v_user_id uuid;
  v_chat_id_enc bytea;
  v_chat_id_hmac text;
  v_now timestamptz := now();
begin
  if p_nonce is null or p_nonce !~ '^[0-9a-fA-F]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_OR_EXPIRED');
  end if;

  if p_bale_chat_id is null or btrim(p_bale_chat_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CHAT_ID');
  end if;

  v_nonce_hash := private.bale_link_hmac_v1(p_nonce, 'bale_link');

  update public.bale_link_nonces n
     set used_at = v_now
   where n.nonce_hash = v_nonce_hash
     and n.used_at is null
     and n.expires_at > v_now
  returning n.user_id into v_user_id;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_OR_EXPIRED');
  end if;

  v_chat_id_enc := private.bale_chat_encrypt_v1(p_bale_chat_id);
  v_chat_id_hmac := private.bale_link_hmac_v1(p_bale_chat_id, 'bale_chat_id');

  insert into public.user_bale_mapping (
    user_id,
    bale_chat_id,
    bale_chat_id_enc,
    bale_chat_id_hmac,
    auth_codes_enabled,
    bale_mfa_codes_enabled,
    connected_at,
    last_connected_at
  ) values (
    v_user_id,
    p_bale_chat_id,
    v_chat_id_enc,
    v_chat_id_hmac,
    true,
    true,
    v_now,
    v_now
  )
  on conflict (user_id) do update
     set bale_chat_id = excluded.bale_chat_id,
         bale_chat_id_enc = excluded.bale_chat_id_enc,
         bale_chat_id_hmac = excluded.bale_chat_id_hmac,
         auth_codes_enabled = true,
         bale_mfa_codes_enabled = true,
         connected_at = coalesce(public.user_bale_mapping.connected_at, excluded.connected_at),
         last_connected_at = excluded.last_connected_at;

  update public.custom_mfa_factors f
     set bale_chat_id_enc = v_chat_id_enc,
         bale_chat_id_hmac = v_chat_id_hmac,
         factor_status = 'active',
         updated_at = v_now
   where f.user_id = v_user_id
     and f.factor_type = 'bale';

  insert into public.security_audit_events (
    user_id,
    actor_user_id,
    event_type,
    event_category,
    severity,
    result
  ) values (
    v_user_id,
    v_user_id,
    'bale_mfa_linked',
    'mfa',
    'info',
    'success'
  );

  return jsonb_build_object('ok', true, 'user_id', v_user_id);
end;
$$;

revoke all on function public.consume_bale_link_nonce_service(text, text) from public, anon, authenticated;
grant execute on function public.consume_bale_link_nonce_service(text, text) to service_role;
