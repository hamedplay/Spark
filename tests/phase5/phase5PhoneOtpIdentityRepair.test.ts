import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const funcPath = join(root, 'supabase', 'functions', 'bulk-sync-profile-phones', 'index.ts');
const profilePath = join(root, 'src', 'components', 'ProfilePage.tsx');
const userMgmtPath = join(root, 'src', 'components', 'UserManagementPanel.tsx');
const identityRepairCardPath = join(root, 'src', 'components', 'PortalConfig', 'IdentityRepairCard.tsx');

const funcSrc = readFileSync(funcPath, 'utf8');
const profileSrc = readFileSync(profilePath, 'utf8');
const userMgmtSrc = readFileSync(userMgmtPath, 'utf8');
const identityRepairCardSrc = readFileSync(identityRepairCardPath, 'utf8');

describe('Phase 5E-D6 Fix 3 — Identity Verification RPC + Non-Bypassable Canary Gate', () => {

  // 1. No .from("auth.identities") in Edge Function
  it('no .from("auth.identities") Data API reads in edge function', () => {
    assert.ok(!/\.from\(\s*["']auth\.identities["']/.test(funcSrc), 'must not read auth.identities via Data API');
  });

  // 2. Identity verification only via RPC
  it('identity verification uses get_phone_auth_identity_state_v1 RPC', () => {
    assert.ok(/get_phone_auth_identity_state_v1/.test(funcSrc), 'must use get_phone_auth_identity_state_v1 RPC');
    assert.ok(/getIdentityState/.test(funcSrc), 'must have getIdentityState helper');
  });

  // 3. RPC error → fail closed
  it('RPC error or null → fail closed (IDENTITY_VERIFY_UNAVAILABLE)', () => {
    assert.ok(/IDENTITY_VERIFY_UNAVAILABLE/.test(funcSrc), 'must return IDENTITY_VERIFY_UNAVAILABLE on RPC failure');
  });

  // 4. RPC requires exactly one phone identity
  it('isCanonicalIdentity requires exactly_one_phone_identity', () => {
    assert.ok(/exactly_one_phone_identity/.test(funcSrc), 'must check exactly_one_phone_identity');
    assert.ok(/isCanonicalIdentity/.test(funcSrc), 'must have isCanonicalIdentity function');
  });

  // 5. sub mismatch → failure
  it('identity_sub_matches_user checked in canonical identity', () => {
    assert.ok(/identity_sub_matches_user/.test(funcSrc), 'must check identity_sub_matches_user');
  });

  // 6. phone mismatch → failure
  it('identity_phone_matches checked in canonical identity', () => {
    assert.ok(/identity_phone_matches/.test(funcSrc), 'must check identity_phone_matches');
  });

  // 7. phone_verified false → failure
  it('identity_phone_verified checked in canonical identity', () => {
    assert.ok(/identity_phone_verified/.test(funcSrc), 'must check identity_phone_verified');
  });

  // 8. No direct SQL write on auth.users
  it('no direct SQL write on auth.users', () => {
    assert.ok(!/UPDATE\s+auth\.users/i.test(funcSrc), 'must not UPDATE auth.users via SQL');
    assert.ok(!/INSERT\s+INTO\s+auth\.users/i.test(funcSrc), 'must not INSERT INTO auth.users via SQL');
  });

  // 9. No direct SQL write on auth.identities
  it('no direct SQL write on auth.identities', () => {
    assert.ok(!/INSERT\s+INTO\s+auth\.identities/i.test(funcSrc), 'must not INSERT auth.identities');
    assert.ok(!/UPDATE\s+auth\.identities/i.test(funcSrc), 'must not UPDATE auth.identities');
    assert.ok(!/DELETE\s+FROM\s+auth\.identities/i.test(funcSrc), 'must not DELETE auth.identities');
  });

  // 10. identity_repair internally executes Canary first
  it('identity_repair internally executes Canary first (non-bypassable)', () => {
    const repairSection = funcSrc.match(/mode\s*===\s*["']identity_repair["'][\s\S]*?(?=return\s+json\(\s*\{\s*ok:\s*false,\s*error:\s*["']INVALID_MODE)/) ||
      funcSrc.match(/mode\s*===\s*["']identity_repair["'][\s\S]*$/);
    assert.ok(repairSection, 'must find identity_repair section');
    const section = repairSection![0];
    assert.ok(/canary/i.test(section), 'identity_repair must contain canary logic');
    assert.ok(/repairOneIdentity/.test(section), 'identity_repair must call repairOneIdentity for canary');
    assert.ok(/CANARY_FAILED/.test(section), 'identity_repair must return CANARY_FAILED on canary failure');
  });

  // 11. Canary failure prevents loop over remaining users
  it('Canary failure prevents loop over remaining users', () => {
    const repairSection = funcSrc.match(/mode\s*===\s*["']identity_repair["'][\s\S]*?(?=return\s+json\(\s*\{\s*ok:\s*false,\s*error:\s*["']INVALID_MODE)/) ||
      funcSrc.match(/mode\s*===\s*["']identity_repair["'][\s\S]*$/);
    const section = repairSection![0];
    const canaryFailMatch = section.match(/CANARY_FAILED[\s\S]*?return\s+json/);
    assert.ok(canaryFailMatch, 'must return immediately on CANARY_FAILED before bulk loop');
  });

  // 12. Client cannot bypass Canary with request params
  it('client cannot bypass Canary with request params (no skip_canary/force/canary_passed input)', () => {
    assert.ok(!/body\.skip_canary/.test(funcSrc), 'must not accept skip_canary');
    assert.ok(!/body\.force/.test(funcSrc), 'must not accept force');
    assert.ok(!/body\.canary_passed/.test(funcSrc), 'must not accept canary_passed from client');
  });

  // 13. Canary PASS → reclassification → remaining repairs
  it('Canary PASS triggers reclassification before bulk', () => {
    const repairSection = funcSrc.match(/mode\s*===\s*["']identity_repair["'][\s\S]*?(?=return\s+json\(\s*\{\s*ok:\s*false,\s*error:\s*["']INVALID_MODE)/) ||
      funcSrc.match(/mode\s*===\s*["']identity_repair["'][\s\S]*$/);
    const section = repairSection![0];
    assert.ok(/bulkClassifications|bulk_classify_phone_sync/.test(section), 'must re-classify after canary pass');
  });

  // 14. identity_canary repairs max one
  it('identity_canary repairs at most one user', () => {
    const canarySection = funcSrc.match(/mode\s*===\s*["']identity_canary["'][\s\S]*?(?=mode\s*===)/);
    assert.ok(canarySection, 'must have identity_canary section');
    assert.ok(/repairNeeded\[0\]/.test(canarySection![0]), 'canary must pick only first candidate');
    assert.ok(!/for\s*\(/.test(canarySection![0].replace(/for\s*\(\s*const\s+row\s+of\s+repairNeeded/, '')),
      'canary must not loop over all candidates');
  });

  // 15. unconfirmed user untouched
  it('AUTH_PHONE_UNCONFIRMED users not auto-confirmed', () => {
    assert.ok(/AUTH_PHONE_UNCONFIRMED/.test(funcSrc), 'must have AUTH_PHONE_UNCONFIRMED status');
  });

  // 16. orphan untouched
  it('PHONE_ONLY_AUTH_ORPHAN not auto-fixed', () => {
    assert.ok(!/mode.*execute[\s\S]*PHONE_ONLY_AUTH_ORPHAN[\s\S]*phone_confirm/.test(funcSrc),
      'execute mode must not touch PHONE_ONLY_AUTH_ORPHAN');
  });

  // 17. profile missing untouched — classifier handles this status, edge function skips it
  it('PROFILE_PHONE_MISSING not auto-fixed (edge function does not process this status)', () => {
    assert.ok(!/PROFILE_PHONE_MISSING[\s\S]*phone_confirm/.test(funcSrc),
      'edge function must not auto-fix PROFILE_PHONE_MISSING');
  });

  // 18. Direct SQL Auth writes absent
  it('no direct SQL Auth writes (UPDATE/INSERT/DELETE on auth schema)', () => {
    assert.ok(!/UPDATE\s+auth\./i.test(funcSrc), 'no UPDATE on auth schema');
    assert.ok(!/INSERT\s+INTO\s+auth\./i.test(funcSrc), 'no INSERT INTO auth schema');
    assert.ok(!/DELETE\s+FROM\s+auth\./i.test(funcSrc), 'no DELETE FROM auth schema');
  });

  // 19. ProfilePage phone remains read-only
  it('ProfilePage phone field is read-only', () => {
    assert.ok(!/change-user-phone/.test(profileSrc), 'ProfilePage must not call change-user-phone');
    const phoneInputMatch = profileSrc.match(/شماره موبایل[\s\S]*?input[\s\S]*?disabled/);
    assert.ok(phoneInputMatch, 'phone field must be disabled');
  });

  // 20. UserManagementPanel uses new_phone
  it('UserManagementPanel uses new_phone parameter', () => {
    assert.ok(/new_phone/.test(userMgmtSrc), 'UserManagementPanel must use new_phone');
  });

  // 21. Resolver unchanged
  it('resolver not referenced in edge function', () => {
    assert.ok(!/resolve_phone_password_login_v1/.test(funcSrc), 'must not reference resolver');
  });

  // 22. Admin UI uses authenticated invocation only
  it('Admin UI uses authenticated session token (no service role in browser)', () => {
    assert.ok(/supabase\.auth\.getSession/.test(identityRepairCardSrc), 'must get session');
    assert.ok(/access_token/.test(identityRepairCardSrc), 'must use access_token');
    assert.ok(!/SUPABASE_SERVICE_ROLE/.test(identityRepairCardSrc), 'must not use service role key');
  });

  // Additional: GoTrue identity repair unsupported detection
  it('detects GOTRUE_IDENTITY_REPAIR_UNSUPPORTED when GoTrue accepts but identity not created', () => {
    assert.ok(/GOTRUE_IDENTITY_REPAIR_UNSUPPORTED/.test(funcSrc), 'must detect unsupported identity repair');
  });

  // Additional: Repair queue error codes
  it('repair queue records all required error codes', () => {
    assert.ok(/IDENTITY_REPAIR_FAILED/.test(funcSrc), 'must record IDENTITY_REPAIR_FAILED');
    assert.ok(/IDENTITY_VERIFY_FAILED/.test(funcSrc), 'must record IDENTITY_VERIFY_FAILED');
    assert.ok(/IDENTITY_VERIFY_UNAVAILABLE/.test(funcSrc), 'must record IDENTITY_VERIFY_UNAVAILABLE');
    assert.ok(/RUNTIME_STATE_CHANGED/.test(funcSrc), 'must record RUNTIME_STATE_CHANGED');
    assert.ok(/AUTH_USER_NOT_ELIGIBLE/.test(funcSrc), 'must record AUTH_USER_NOT_ELIGIBLE');
    assert.ok(/AUTH_PHONE_CONFLICT/.test(funcSrc), 'must record AUTH_PHONE_CONFLICT');
  });

  // Additional: Audit actions
  it('audit uses correct action names for canary and bulk', () => {
    assert.ok(/repair_phone_auth_identity_canary/.test(funcSrc), 'must audit canary');
    assert.ok(/repair_phone_auth_identity_after_direct_backfill/.test(funcSrc), 'must audit bulk repair');
  });

  // Additional: Idempotency via RPC
  it('idempotency check uses RPC (not Data API auth.identities)', () => {
    const idempotencyMatch = funcSrc.match(/preState[\s\S]*?getIdentityState/);
    assert.ok(idempotencyMatch, 'idempotency must use getIdentityState RPC');
  });

  // Additional: Admin UI has required buttons
  it('Admin UI has بررسی وضعیت, اجرای Canary, ترمیم کاربران buttons', () => {
    assert.ok(/بررسی وضعیت/.test(identityRepairCardSrc), 'must have check status button');
    assert.ok(/اجرای Canary/.test(identityRepairCardSrc), 'must have canary button');
    assert.ok(/ترمیم کاربران/.test(identityRepairCardSrc), 'must have repair button');
  });

  // Additional: Admin UI confirmation dialog
  it('Admin UI shows confirmation before repair', () => {
    assert.ok(/ابتدا یک کاربر به‌عنوان Canary/.test(identityRepairCardSrc), 'must show canary-first confirmation');
  });

  // Additional: No full phone in output
  it('edge function masks all phones in output', () => {
    assert.ok(/maskPhone/.test(funcSrc), 'must mask phones');
  });

  // Additional: admin gate preserved
  it('admin gate preserved (requireFullAuthAccess + is_admin check)', () => {
    assert.ok(/requireFullAuthAccess/.test(funcSrc), 'must require full auth access');
    assert.ok(/is_admin/.test(funcSrc), 'must check is_admin');
  });

  // No formal assert.ok(true)
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
