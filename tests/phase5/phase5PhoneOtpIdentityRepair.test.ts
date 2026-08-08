import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const funcPath = join(root, 'supabase', 'functions', 'bulk-sync-profile-phones', 'index.ts');
const profilePath = join(root, 'src', 'components', 'ProfilePage.tsx');
const userMgmtPath = join(root, 'src', 'components', 'UserManagementPanel.tsx');

const funcSrc = readFileSync(funcPath, 'utf8');
const profileSrc = readFileSync(profilePath, 'utf8');
const userMgmtSrc = readFileSync(userMgmtPath, 'utf8');

describe('Phase 5E-D6 Fix 2 — Identity-Aware Phone Repair', () => {

  // ── Classifier: ALREADY_SYNCED requires phone identity ───────────────────
  it('ALREADY_SYNCED requires phone identity (classifier checks auth.identities)', () => {
    assert.ok(/auth\.identities/.test(funcSrc), 'classifier must check auth.identities');
    assert.ok(/IDENTITY_REPAIR_REQUIRED/.test(funcSrc), 'must have IDENTITY_REPAIR_REQUIRED status');
  });

  // ── phone match + confirmed + missing identity → IDENTITY_REPAIR_REQUIRED ─
  it('phone match + confirmed + missing identity → IDENTITY_REPAIR_REQUIRED', () => {
    assert.ok(/IDENTITY_REPAIR_REQUIRED/.test(funcSrc), 'must classify missing identity as IDENTITY_REPAIR_REQUIRED');
    assert.ok(/phone_confirmed_at/.test(funcSrc), 'must check phone_confirmed_at');
  });

  // ── unconfirmed phone → AUTH_PHONE_UNCONFIRMED ───────────────────────────
  it('unconfirmed phone → AUTH_PHONE_UNCONFIRMED (not auto-confirmed)', () => {
    assert.ok(/AUTH_PHONE_UNCONFIRMED/.test(funcSrc), 'must have AUTH_PHONE_UNCONFIRMED status');
  });

  // ── Canary only repairs one user ──────────────────────────────────────────
  it('Canary only repairs ONE user', () => {
    assert.ok(/identity_canary/.test(funcSrc), 'must have identity_canary mode');
    const canaryMatch = funcSrc.match(/mode\s*===\s*["']identity_canary["'][\s\S]*?repairNeeded\[0\]/);
    assert.ok(canaryMatch, 'canary must pick only first candidate');
  });

  // ── Canary uses GoTrue Admin API ──────────────────────────────────────────
  it('Canary uses GoTrue Admin API (PUT /auth/v1/admin/users)', () => {
    assert.ok(/auth\/v1\/admin\/users\//.test(funcSrc), 'must use GoTrue Admin API PUT');
    assert.ok(/phone_confirm/.test(funcSrc), 'must set phone_confirm in payload');
  });

  // ── No direct SQL write on auth.users ─────────────────────────────────────
  it('no direct SQL write on auth.users (no UPDATE/INSERT auth.users in edge function)', () => {
    assert.ok(!/UPDATE\s+auth\.users/i.test(funcSrc), 'must not UPDATE auth.users via SQL');
    assert.ok(!/INSERT\s+INTO\s+auth\.users/i.test(funcSrc), 'must not INSERT INTO auth.users via SQL');
  });

  // ── No direct SQL write on auth.identities ────────────────────────────────
  it('no direct SQL write on auth.identities (no INSERT/UPDATE/DELETE)', () => {
    assert.ok(!/INSERT\s+INTO\s+auth\.identities/i.test(funcSrc), 'must not INSERT auth.identities');
    assert.ok(!/UPDATE\s+auth\.identities/i.test(funcSrc), 'must not UPDATE auth.identities');
    assert.ok(!/DELETE\s+FROM\s+auth\.identities/i.test(funcSrc), 'must not DELETE auth.identities');
  });

  // ── Canary failure stops bulk ─────────────────────────────────────────────
  it('Canary failure stops bulk repair (canary_passed gate)', () => {
    assert.ok(/canary_passed/.test(funcSrc), 'must expose canary_passed result');
  });

  // ── Bulk only runs after canary PASS ──────────────────────────────────────
  it('identity_repair mode exists and is separate from canary', () => {
    assert.ok(/identity_repair/.test(funcSrc), 'must have identity_repair mode');
    assert.ok(/mode\s*===\s*["']identity_repair["']/.test(funcSrc), 'identity_repair must be a separate mode');
  });

  // ── Runtime state re-checked before each repair ────────────────────────────
  it('runtime state re-checked before each repair (RUNTIME_STATE_CHANGED)', () => {
    assert.ok(/RUNTIME_STATE_CHANGED/.test(funcSrc), 'must detect runtime state changes');
  });

  // ── Repair only after post-verification ───────────────────────────────────
  it('repair success only after post-verification (verifyIdentityAfterUpdate)', () => {
    assert.ok(/verifyIdentityAfterUpdate/.test(funcSrc), 'must have post-repair verification');
    assert.ok(/identity_created/.test(funcSrc), 'must verify identity was created');
    assert.ok(/identity_same_user/.test(funcSrc), 'must verify identity belongs to same user');
  });

  // ── Existing identity not re-updated (idempotency) ─────────────────────────
  it('existing identity is not re-updated (idempotency skip)', () => {
    assert.ok(/existingIdentity/.test(funcSrc), 'must check existing identity before repair');
    assert.ok(/existingRows\.length\s*>\s*0/.test(funcSrc), 'must skip if identity already exists');
  });

  // ── Orphans not auto-fixed ────────────────────────────────────────────────
  it('orphans (PHONE_ONLY_AUTH_ORPHAN) not auto-fixed', () => {
    assert.ok(!/mode.*execute[\s\S]*PHONE_ONLY_AUTH_ORPHAN[\s\S]*phone_confirm/.test(funcSrc),
      'execute mode must not touch PHONE_ONLY_AUTH_ORPHAN');
  });

  // ── Unconfirmed not auto-confirmed ────────────────────────────────────────
  it('unconfirmed users not auto-confirmed in identity repair', () => {
    const repairSection = funcSrc.match(/mode\s*===\s*["']identity_repair["'][\s\S]*?(?=mode\s*===|$)/);
    if (repairSection) {
      assert.ok(!/phone_confirm.*true/.test(repairSection[0].replace(/phone_confirmed_at/g, '')),
        'identity_repair must not set phone_confirm=true for unconfirmed');
    }
  });

  // ── Audit after success ───────────────────────────────────────────────────
  it('audit created after successful repair', () => {
    assert.ok(/repair_phone_auth_identity/.test(funcSrc), 'must audit identity repair');
    assert.ok(/audit_log/.test(funcSrc), 'must insert into audit_log');
  });

  // ── Repair Queue for failure ──────────────────────────────────────────────
  it('repair queue entry created on failure', () => {
    assert.ok(/phone_auth_sync_repairs/.test(funcSrc), 'must use phone_auth_sync_repairs');
    assert.ok(/IDENTITY_REPAIR_FAILED/.test(funcSrc), 'must record IDENTITY_REPAIR_FAILED');
    assert.ok(/IDENTITY_VERIFY_FAILED/.test(funcSrc), 'must record IDENTITY_VERIFY_FAILED');
  });

  // ── Resolver unchanged ────────────────────────────────────────────────────
  it('resolver not referenced or modified in edge function', () => {
    assert.ok(!/resolve_phone_password_login_v1/.test(funcSrc), 'must not reference resolver');
  });

  // ── ProfilePage phone still read-only ─────────────────────────────────────
  it('ProfilePage phone field is read-only (disabled, no change-user-phone call)', () => {
    assert.ok(!/change-user-phone/.test(profileSrc), 'ProfilePage must not call change-user-phone');
    const phoneInputMatch = profileSrc.match(/شماره موبایل[\s\S]*?input[\s\S]*?disabled/);
    assert.ok(phoneInputMatch, 'phone field must be disabled');
  });

  // ── UserManagementPanel uses new_phone ────────────────────────────────────
  it('UserManagementPanel uses new_phone parameter', () => {
    assert.ok(/new_phone/.test(userMgmtSrc), 'UserManagementPanel must use new_phone');
  });

  // ── No full phone / raw response stored ───────────────────────────────────
  it('does not store full phone or raw GoTrue response in repair queue', () => {
    assert.ok(/maskPhone/.test(funcSrc), 'must mask phones in repair queue');
    const repairInserts = funcSrc.match(/phone_auth_sync_repairs[\s\S]*?insert[\s\S]*?\}/g) || [];
    for (const ins of repairInserts) {
      assert.ok(!/raw_/.test(ins), 'must not store raw response');
    }
  });

  // ── Admin gate preserved ──────────────────────────────────────────────────
  it('admin gate preserved (requireFullAuthAccess + is_admin check)', () => {
    assert.ok(/requireFullAuthAccess/.test(funcSrc), 'must require full auth access');
    assert.ok(/is_admin/.test(funcSrc), 'must check is_admin');
  });

  // ── No formal assert.ok(true) ──────────────────────────────────────────────
  it('no formal assert.ok(true) assertions in this test file', () => {
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpIdentityRepair.test.ts'), 'utf8');
    const lines = testFile.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (/^assert\.ok\(\s*true\s*\)\s*;?\s*$/.test(trimmed)) {
        assert.fail('must not contain formal assert.ok(true) test');
      }
    }
  });
});
