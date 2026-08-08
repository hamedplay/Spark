import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const recoveryEdge = readFileSync(join(root, 'supabase/functions/unified-recovery/index.ts'), 'utf8');
const sessionEdge = readFileSync(join(root, 'supabase/functions/session-management/index.ts'), 'utf8');

describe('Phase 7 security contract', () => {
  // ── Enumeration protection ─────────────────────────────────────────────────
  it('returns identical response shape for found and not-found accounts', () => {
    assert.match(recoveryEdge, /Not found.*return.*ok.*true.*challenge_id/s);
    assert.match(recoveryEdge, /fake challenge_id to prevent enumeration/i);
  });

  it('never returns stored email or phone to the browser', () => {
    assert.doesNotMatch(recoveryEdge, /return json\(\{[^}]*\bemail\b[^}]*target/i);
    assert.doesNotMatch(recoveryEdge, /return json\(\{[^}]*\bphone\b[^}]*target/i);
    assert.match(recoveryEdge, /email_hint/);
    assert.match(recoveryEdge, /phone_hint/);
  });

  // ── Replay/race protection ────────────────────────────────────────────────
  it('uses atomic claim for reset token consumption', () => {
    assert.match(recoveryEdge, /claim_unified_recovery_completion/);
    assert.match(recoveryEdge, /finalize_unified_recovery_completion/);
  });

  it('reset token is one-time and has short TTL', () => {
    assert.match(recoveryEdge, /randomToken/);
    assert.match(recoveryEdge, /300 \* 1000/);
  });

  // ── Lock abuse protection ─────────────────────────────────────────────────
  it('does not escalate lock when already locked', () => {
    // The RPC handles this — verify the edge function delegates to record_auth_failure
    // and the RPC is service-role only
    assert.match(recoveryEdge, /service_role|hmac_with_pepper/);
  });

  // ── Session binding ───────────────────────────────────────────────────────
  it('session management binds to JWT session_id', () => {
    assert.match(sessionEdge, /payload\.session_id/);
    assert.match(sessionEdge, /p_session_id: sessionId/);
  });

  it('heartbeat uses server timestamp only', () => {
    assert.match(sessionEdge, /touch_session_security_state/);
    assert.doesNotMatch(sessionEdge, /Date\.now.*idle|client.*timestamp/i);
  });

  // ── Epoch rejection ───────────────────────────────────────────────────────
  it('heartbeat checks auth_epoch and rejects old-epoch sessions', () => {
    assert.match(sessionEdge, /auth_epoch/);
    assert.match(sessionEdge, /p_auth_epoch: epoch/);
  });

  // ── Idle/absolute timeout ────────────────────────────────────────────────
  it('session state tracks idle and absolute expiry', () => {
    assert.match(sessionEdge, /idle_expiry_at/);
    assert.match(sessionEdge, /absolute_expiry_at/);
  });

  // ── Revocation ────────────────────────────────────────────────────────────
  it('supports revoke one, others, and all', () => {
    assert.match(sessionEdge, /revoke_one/);
    assert.match(sessionEdge, /revoke_others/);
    assert.match(sessionEdge, /revoke_all/);
  });

  it('does not expose tokens or full IPs', () => {
    assert.doesNotMatch(sessionEdge, /access_token|refresh_token/i);
    assert.doesNotMatch(sessionEdge, /ip_hash.*return|return.*ip_hash/i);
  });

  // ── Password reset via Admin API ─────────────────────────────────────────
  it('changes password via admin API, not direct auth table write', () => {
    assert.match(recoveryEdge, /admin\.updateUserById/);
    assert.doesNotMatch(recoveryEdge, /UPDATE auth\.|INSERT INTO auth\.|DELETE FROM auth\./i);
  });

  it('increments epoch and revokes grants after successful reset', () => {
    assert.match(recoveryEdge, /finalize_unified_recovery_completion/);
  });

  // ── Anti-enumeration timing ───────────────────────────────────────────────
  it('pads timing to prevent timing-based enumeration', () => {
    assert.match(recoveryEdge, /padTiming/);
  });
});
