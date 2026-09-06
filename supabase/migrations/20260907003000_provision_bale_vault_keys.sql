-- Provision the cryptographic material required by the Bale account-linking flow.
-- Keys are generated independently per environment and are never rotated by this migration.

do $$
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'bale_link_hmac_key_v1'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'bale_link_hmac_key_v1',
      'Spark Bale link nonce HMAC key v1'
    );
  end if;

  if not exists (
    select 1
    from vault.secrets
    where name = 'bale_chat_encryption_key_v1'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'bale_chat_encryption_key_v1',
      'Spark Bale chat-id encryption key v1'
    );
  end if;
end
$$;
