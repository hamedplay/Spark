import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const edge = readFileSync(join(root, 'supabase/functions/custom-mfa/index.ts'), 'utf8');

describe('Phase 6 Custom MFA security contract', () => {
  it('binds challenge creation and verification to the JWT session', () => {
    assert.match(edge, /sessionIdFrom/);
    assert.match(edge, /p_session_id: caller\.sessionId/);
    assert.match(edge, /p_session_id: caller\.sessionId/);
  });

  it('uses atomic pending-to-consumed updates for replay and race protection', () => {
    assert.match(edge, /consume_custom_mfa_challenge_service/);
    assert.match(edge, /consume_custom_mfa_challenge_service/);
  });

  it('enforces phone OTP factor independence', () => {
    assert.match(edge, /isPhoneOtpPrimary/);
    assert.match(edge, /FACTOR_INDEPENDENCE_REQUIRED/);
  });

  it('keeps OTP and recovery values HMAC-only at rest', () => {
    assert.match(edge, /hmac\(otp, "mfa_otp"\)/);
    assert.match(edge, /hmac\(body\.code, "mfa_recovery"\)/);
    assert.match(edge, /p_otp_hash/);
    assert.match(edge, /p_code_hash/);
  });

  it('does not use Supabase aal2 or write auth tables', () => {
    assert.doesNotMatch(edge, /aal2|auth\.users|auth\.identities/);
    assert.doesNotMatch(edge, /INSERT INTO auth\.|UPDATE auth\.|DELETE FROM auth\./i);
  });

  it('keeps email unavailable until a secure transport exists', () => {
    assert.match(edge, /EMAIL_TRANSPORT_UNAVAILABLE/);
  });

  it('does not send primary login or recovery OTPs through Bale', () => {
    assert.match(edge, /custom_mfa/);
    assert.doesNotMatch(edge, /phone_login|password_reset|recovery.*bale/i);
  });

  it('does not expose raw OTPs in the public response', () => {
    assert.doesNotMatch(edge, /return json\(\{[^}]*\b(?:otp|code)\s*:/i);
    assert.match(edge, /challenge_id: challenge\.challenge_id/);
  });
});
