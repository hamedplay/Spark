-- Keep legacy rows readable, but allow all new Bale links to avoid plaintext chat IDs.
alter table public.user_bale_mapping
  alter column bale_chat_id drop not null;

-- Provision Bale-specific cryptographic material inside Vault when missing.
-- Values are generated inside Postgres and are never embedded in source code.
do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'bale_link_hmac_key_v1'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'bale_link_hmac_key_v1',
      'HMAC key for one-time Bale link tokens and chat-id fingerprints',
      null
    );
  end if;

  if not exists (
    select 1 from vault.secrets where name = 'bale_chat_encryption_key_v1'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'bale_chat_encryption_key_v1',
      'Encryption key for Bale chat IDs',
      null
    );
  end if;
end
$$;

create or replace function private.bale_link_hmac_v1(
  p_input text,
  p_context text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select decrypted_secret
    into v_key
  from vault.decrypted_secrets
  where name = 'bale_link_hmac_key_v1'
  order by updated_at desc
  limit 1;

  if v_key is null or v_key = '' then
    raise exception 'BALE_LINK_HMAC_KEY_NOT_CONFIGURED';
  end if;

  return encode(
    extensions.hmac(
      convert_to(coalesce(p_input, ''), 'utf8'),
      convert_to(coalesce(p_context, '') || ':' || v_key, 'utf8'),
      'sha256'
    ),
    'hex'
  );
end;
$$;

create or replace function private.bale_chat_encrypt_v1(p_plaintext text)
returns bytea
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select decrypted_secret
    into v_key
  from vault.decrypted_secrets
  where name = 'bale_chat_encryption_key_v1'
  order by updated_at desc
  limit 1;

  if v_key is null or v_key = '' then
    raise exception 'BALE_CHAT_ENCRYPTION_KEY_NOT_CONFIGURED';
  end if;

  return extensions.pgp_sym_encrypt(
    p_plaintext,
    v_key,
    'cipher-algo=aes256, compress-algo=0'
  );
end;
$$;

create or replace function private.bale_chat_decrypt_v1(p_ciphertext bytea)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select decrypted_secret
    into v_key
  from vault.decrypted_secrets
  where name = 'bale_chat_encryption_key_v1'
  order by updated_at desc
  limit 1;

  if v_key is null or v_key = '' then
    raise exception 'BALE_CHAT_ENCRYPTION_KEY_NOT_CONFIGURED';
  end if;

  return extensions.pgp_sym_decrypt(p_ciphertext, v_key);
end;
$$;

revoke all on function private.bale_link_hmac_v1(text, text) from public, anon, authenticated;
revoke all on function private.bale_chat_encrypt_v1(text) from public, anon, authenticated;
revoke all on function private.bale_chat_decrypt_v1(bytea) from public, anon, authenticated;

-- Called only by the authenticated Bale-link Edge Function through service_role.
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

  v_nonce := encode(gen_random_bytes(32), 'hex');
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

-- Atomically consumes a one-time token and stores only encrypted/fingerprinted chat ID.
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
    null,
    v_chat_id_enc,
    v_chat_id_hmac,
    true,
    true,
    v_now,
    v_now
  )
  on conflict (user_id) do update
     set bale_chat_id = null,
         bale_chat_id_enc = excluded.bale_chat_id_enc,
         bale_chat_id_hmac = excluded.bale_chat_id_hmac,
         auth_codes_enabled = true,
         bale_mfa_codes_enabled = true,
         connected_at = coalesce(public.user_bale_mapping.connected_at, excluded.connected_at),
         last_connected_at = excluded.last_connected_at;

  -- Preserve the previous behavior only when a Bale MFA factor already exists.
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

-- Backward-compatible resolver for senders: use legacy plaintext only for old rows,
-- otherwise decrypt the new encrypted-only mapping inside the database.
create or replace function public.get_bale_chat_id_service(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plaintext text;
  v_ciphertext bytea;
begin
  select m.bale_chat_id, m.bale_chat_id_enc
    into v_plaintext, v_ciphertext
  from public.user_bale_mapping m
  where m.user_id = p_user_id;

  if v_plaintext is not null and btrim(v_plaintext) <> '' then
    return v_plaintext;
  end if;

  if v_ciphertext is null then
    return null;
  end if;

  return private.bale_chat_decrypt_v1(v_ciphertext);
end;
$$;

revoke all on function public.get_bale_chat_id_service(uuid) from public, anon, authenticated;
grant execute on function public.get_bale_chat_id_service(uuid) to service_role;
