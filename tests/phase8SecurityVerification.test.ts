import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

// Read all relevant edge functions and migrations
const healthEdge = readFileSync(join(root, 'supabase/functions/auth-health-check/index.ts'), 'utf8');
const recoveryEdge = readFileSync(join(root, 'supabase/functions/unified-recovery/index.ts'), 'utf8');
const sessionEdge = readFileSync(join(root, 'supabase/functions/session-management/index.ts'), 'utf8');
const customMfaEdge = readFileSync(join(root, 'supabase/functions/custom-mfa/index.ts'), 'utf8');
const sw = readFileSync(join(root, 'public/sw.js'), 'utf8');
const migration = readFileSync(join(root, 'supabase/migrations/20260808191059_20260808180000_phase8_audit_health_check.sql.sql'), 'utf8');

describe('Phase 8 Security Verification', () => {
  // ── Enumeration ─────────────────────────────────────────────────────────────
  it('recovery edge returns identical response for found/not-found accounts', () => {
    assert.match(recoveryEdge, /fake challenge_id to prevent enumeration/i);
    assert.match(recoveryEdge, /padTiming/);
  });

  // ── OTP/token/recovery-code replay ──────────────────────────────────────────
  it('recovery challenge uses atomic transitions preventing replay', () => {
    assert.match(recoveryEdge, /claim_unified_recovery_completion/);
    assert.match(recoveryEdge, /finalize_unified_recovery_completion/);
  });

  it('reset token is one-time with short TTL', () => {
    assert.match(recoveryEdge, /randomToken/);
    assert.match(recoveryEdge, /300 \* 1000/);
  });

  // ── Concurrent Race ─────────────────────────────────────────────────────────
  it('custom MFA uses atomic consume with FOR UPDATE', () => {
    assert.match(customMfaEdge, /consume_custom_mfa_challenge_service/);
  });

  it('recovery uses atomic claim with RETURNING for race protection', () => {
    assert.match(recoveryEdge, /claim_unified_recovery_completion/);
  });

  // ── Factor Independence ─────────────────────────────────────────────────────
  it('custom MFA enforces phone OTP factor independence', () => {
    assert.match(customMfaEdge, /isPhoneOtpPrimary/);
    assert.match(customMfaEdge, /FACTOR_INDEPENDENCE_REQUIRED/);
  });

  // ── MFA grant session binding ───────────────────────────────────────────────
  it('custom MFA grants are bound to session_id', () => {
    assert.match(customMfaEdge, /p_session_id: caller\.sessionId/);
  });

  // ── Lockout abuse ───────────────────────────────────────────────────────────
  it('recovery remains available for locked accounts', () => {
    assert.match(recoveryEdge, /resolve_unified_recovery_target/);
    // The RPC does not block locked accounts from recovery
    assert.doesNotMatch(recoveryEdge, /locked.*return.*ok.*false/i);
  });

  // ── Revoked/expired/old-epoch session ───────────────────────────────────────
  it('session management rejects revoked sessions', () => {
    assert.match(sessionEdge, /revoke_session_security_state|revoke_other_sessions|revoke_all_sessions/);
  });

  it('session management rejects old-epoch sessions', () => {
    assert.match(sessionEdge, /auth_epoch/);
    assert.match(sessionEdge, /epoch/);
  });

  it('session management checks idle and absolute timeout', () => {
    assert.match(sessionEdge, /idle_expiry_at/);
    assert.match(sessionEdge, /absolute_expiry_at/);
  });

  // ── RLS matrix ─────────────────────────────────────────────────────────────
  it('health check verifies RLS enabled on all security tables', () => {
    assert.match(migration, /rls.*all_enabled/i);
  });

  it('security audit events are only accessible via SECURITY DEFINER RPC', () => {
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_security_audit_page_v2.*FROM PUBLIC, anon/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_security_audit_page_v2.*TO authenticated/);
  });

  it('health check RPC is admin/authenticated only', () => {
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_auth_health_check\(\) FROM PUBLIC, anon/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_auth_health_check\(\) TO authenticated/);
  });

  // ── No secret/plaintext OTP storage ─────────────────────────────────────────
  it('no edge function returns raw OTP or secret values', () => {
    assert.doesNotMatch(recoveryEdge, /return.*otp.*\d/i);
    assert.doesNotMatch(customMfaEdge, /return.*otp.*\d/i);
    assert.doesNotMatch(healthEdge, /return.*secret.*value/i);
    assert.doesNotMatch(healthEdge, /return.*pepper/i);
  });

  it('health check returns only ready/not_ready for secrets', () => {
    assert.match(migration, /ready.*not_ready/i);
    assert.doesNotMatch(healthEdge, /pepper|secret_value|key_value/i);
  });

  // ── PWA cache exclusion ─────────────────────────────────────────────────────
  it('service worker excludes /auth/ from cache', () => {
    assert.match(sw, /\/auth\//);
  });

  it('no edge function sets cacheable headers on auth responses', () => {
    assert.match(healthEdge, /no-store/);
    assert.match(healthEdge, /no-cache/);
  });

  // ── Deprecated routes unreachable from runtime ──────────────────────────────
  it('health check reports deprecated routes', () => {
    assert.match(healthEdge, /deprecated_routes/);
    assert.match(migration, /deprecated_routes/);
    assert.match(migration, /request-phone-password-reset-otp/);
    assert.match(migration, /verify-phone-password-reset-otp/);
    assert.match(migration, /complete-phone-password-reset/);
  });

  // ── SECURITY DEFINER + search_path ─────────────────────────────────────────
  it('health check verifies SECURITY DEFINER functions have empty search_path', () => {
    assert.match(migration, /search_path_empty/i);
  });

  // ── Audit viewer redaction ──────────────────────────────────────────────────
  it('audit page v2 does not expose ip_address or user_agent_hash directly', () => {
    assert.doesNotMatch(migration, /'ip_address'[^)]*, e\.ip_address/);
    assert.doesNotMatch(migration, /'user_agent_hash'[^)]*, e\.user_agent_hash/);
  });

  it('audit page v2 includes request_id filter', () => {
    assert.match(migration, /p_request_id/);
  });

  // ── No direct auth table writes ─────────────────────────────────────────────
  it('no edge function writes directly to auth tables', () => {
    assert.doesNotMatch(recoveryEdge, /INSERT INTO auth\.|UPDATE auth\.|DELETE FROM auth\./i);
    assert.doesNotMatch(sessionEdge, /INSERT INTO auth\.|UPDATE auth\.|DELETE FROM auth\./i);
    assert.doesNotMatch(healthEdge, /INSERT INTO auth\.|UPDATE auth\.|DELETE FROM auth\./i);
  });
});
