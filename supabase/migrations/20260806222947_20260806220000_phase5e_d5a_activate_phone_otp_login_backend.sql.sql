/*
# Phase 5E-D5A: Controlled Phone OTP Backend Activation

## Purpose
Activate the phone OTP login backend by flipping the single feature flag
`phone_otp_login_backend_ready` from `false` to `true`.

## Changes
1. Update `system_config` row:
   - key = `phone_otp_login_backend_ready`
   - section = `security`
   - value: `false` → `true`
   - value_type stays `boolean`

## What This Enables
When `phone_otp_login_backend_ready = true`, the `get_public_auth_config` RPC
computes `phone_login_ready = true` (provided all other gates — canonical
enabled, provider ready, template ready, origins set, TTL/resend/max-attempts
valid — are also satisfied). This makes the "ورود با کد پیامکی" tab in the
login UI selectable for end users.

## Safety
- No tables created, altered, or dropped.
- No columns added, removed, or type-changed.
- No RLS policies created or modified.
- No edge functions deployed or invoked.
- No SMS, OTP, or session created.
- Idempotent: safe to re-run (UPDATE sets value to `true` regardless of prior state).

## Important Notes
1. This migration ONLY changes the feature flag value.
2. The `get_public_auth_config` RPC is NOT recreated or modified — it already
   reads this flag at runtime.
3. The `get_phone_auth_admin_status` RPC is NOT recreated or modified — it
   already reads this flag at runtime.
4. No frontend code is changed by this migration.
5. No edge function code is changed by this migration.
*/

UPDATE public.system_config
SET value = 'true', updated_at = now()
WHERE section = 'security' AND key = 'phone_otp_login_backend_ready';

-- Safety check: if the row somehow doesn't exist, insert it.
INSERT INTO public.system_config (section, key, value, value_type, updated_at)
SELECT 'security', 'phone_otp_login_backend_ready', 'true', 'boolean', now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_config
  WHERE section = 'security' AND key = 'phone_otp_login_backend_ready'
);
