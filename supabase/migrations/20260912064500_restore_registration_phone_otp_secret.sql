-- Restore the Vault-backed HMAC secret required by public registration OTP.
--
-- The registration flow intentionally reads the secret from Vault through
-- public.get_registration_phone_otp_secret_service(). A stale system_config
-- flag can report the secret as configured even when the Vault row is absent.
-- This migration is idempotent: it preserves an existing secret and creates a
-- cryptographically random replacement only when the secret is missing.

do $$
declare
  v_secret_exists boolean;
begin
  select exists (
    select 1
    from vault.decrypted_secrets ds
    where ds.name = 'REGISTRATION_PHONE_OTP_SECRET'
      and nullif(ds.decrypted_secret, '') is not null
  )
  into v_secret_exists;

  if not v_secret_exists then
    perform vault.create_secret(
      pg_catalog.encode(extensions.gen_random_bytes(32), 'hex'),
      'REGISTRATION_PHONE_OTP_SECRET',
      'HMAC secret for public registration OTP challenges',
      null
    );
  end if;

  update public.system_config
  set value = 'true',
      updated_at = clock_timestamp()
  where section = 'security'
    and key = 'registration_phone_otp_secret_configured';

  if not found then
    insert into public.system_config (
      section,
      key,
      value,
      value_type,
      updated_at
    )
    values (
      'security',
      'registration_phone_otp_secret_configured',
      'true',
      'boolean',
      clock_timestamp()
    );
  end if;
end;
$$;