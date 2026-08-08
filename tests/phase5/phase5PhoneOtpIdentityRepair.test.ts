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

describe('Phase 5E-D6 Fix 4 — Strict Pre-Write Fail-Closed + Safe Repair Responses', () => {

  // 1. getIdentityState() === null before GoTrue → NO fetch PUT
  it('pre-verification null → IDENTITY_VERIFY_UNAVAILABLE before any GoTrue PUT', () => {
    const repairSection = funcSrc.match(/async function repairOneIdentity[\s\S]*?^}/m);
    assert.ok(repairSection, 'must find repairOneIdentity');
    const section = repairSection![0];
    // preState null check must come BEFORE the fetch PUT call
    const preStateNullCheck = section.indexOf('IDENTITY_VERIFY_UNAVAILABLE');
    const fetchPut = section.indexOf('fetch(');
    assert.ok(preStateNullCheck > -1, 'must have IDENTITY_VERIFY_UNAVAILABLE in repairOneIdentity');
    assert.ok(fetchPut > -1, 'must have fetch call');
    assert.ok(preStateNullCheck < fetchPut, 'pre-verification fail-closed must come before GoTrue PUT');
  });

  // 2. pre-verification unavailable → IDENTITY_VERIFY_UNAVAILABLE
  it('pre-verification unavailable → IDENTITY_VERIFY_UNAVAILABLE (no write)', () => {
    assert.ok(/if\s*\(!preState\)/.test(funcSrc), 'must check !preState');
    assert.ok(/IDENTITY_VERIFY_UNAVAILABLE/.test(funcSrc), 'must return IDENTITY_VERIFY_UNAVAILABLE');
  });

  // 3. identity_count > 0 but noncanonical → NO GoTrue PUT
  it('identity_count > 0 but noncanonical → NO GoTrue PUT (IDENTITY_STATE_CONFLICT)', () => {
    const repairSection = funcSrc.match(/async function repairOneIdentity[\s\S]*?^}/m);
    const section = repairSection![0];
    const conflictCheck = section.indexOf('IDENTITY_STATE_CONFLICT');
    const fetchPut = section.indexOf('fetch(');
    assert.ok(conflictCheck > -1, 'must have IDENTITY_STATE_CONFLICT');
    assert.ok(conflictCheck < fetchPut, 'conflict check must come before GoTrue PUT');
  });

  // 4. noncanonical existing identity → IDENTITY_STATE_CONFLICT
  it('noncanonical existing identity → IDENTITY_STATE_CONFLICT', () => {
    assert.ok(/IDENTITY_STATE_CONFLICT/.test(funcSrc), 'must use IDENTITY_STATE_CONFLICT error code');
  });

  // 5. canonical preState → no write / idempotent success
  it('canonical preState → idempotent success without GoTrue PUT', () => {
    const repairSection = funcSrc.match(/async function repairOneIdentity[\s\S]*?^}/m);
    const section = repairSection![0];
    const canonicalCheck = section.match(/isCanonicalIdentity\(preState\)[\s\S]*?return\s*{[^}]*success:\s*true/);
    assert.ok(canonicalCheck, 'canonical preState must return success without write');
  });

  // 6. only identity_count=0 can reach same-phone GoTrue repair
  it('only identity_count === 0 reaches GoTrue PUT', () => {
    const repairSection = funcSrc.match(/async function repairOneIdentity[\s\S]*?^}/m);
    const section = repairSection![0];
    // After the canonical check and conflict check, the remaining path to fetch must not have identity_count > 0 guard
    const fetchIdx = section.indexOf('fetch(');
    const beforeFetch = section.slice(0, fetchIdx);
    assert.ok(/identity_count\s*>\s*0/.test(beforeFetch), 'must guard identity_count > 0 before fetch');
    assert.ok(/IDENTITY_STATE_CONFLICT/.test(beforeFetch), 'must return CONFLICT for identity_count > 0');
  });

  // 7. post verification remains strict
  it('post verification checks all canonical identity fields', () => {
    assert.ok(/isCanonicalIdentity\(postState\)/.test(funcSrc), 'must check isCanonicalIdentity on postState');
    assert.ok(/authPhoneOk/.test(funcSrc), 'must check auth phone match');
    assert.ok(/phoneConfirmed/.test(funcSrc), 'must check phone_confirmed_at');
  });

  // 8. dry_run response contains no classifications
  it('dry_run response contains no classifications array', () => {
    const match = funcSrc.match(/return\s+json\(\s*\{\s*ok:\s*true,\s*mode:\s*["']dry_run["'],\s*summary\s*\}\s*\)/);
    assert.ok(match, 'must find dry_run success return: json({ ok: true, mode: dry_run, summary })');
    assert.ok(!/classifications/.test(match![0]), 'dry_run json response must not contain classifications');
  });

  // 9. dry_run response contains no user_id
  it('dry_run response contains no user_id', () => {
    const match = funcSrc.match(/return\s+json\(\s*\{\s*ok:\s*true,\s*mode:\s*["']dry_run["'],\s*summary\s*\}\s*\)/);
    assert.ok(match, 'must find dry_run success return');
    assert.ok(!/user_id/.test(match![0]), 'dry_run json must not contain user_id');
  });

  // 10. Canary public response contains no user_id
  it('canary public response contains no user_id (uses toPublic)', () => {
    const match = funcSrc.match(/canary_result:\s*toPublic\(result\),\s*canary_passed:\s*result\.success/);
    assert.ok(match, 'canary response must use toPublic(result)');
    // Verify the canary return json does not directly expose user_id
    const canaryReturn = funcSrc.match(/mode:\s*["']identity_canary["'][\s\S]*?return\s+json\(\s*\{[\s\S]*?\}\s*\)/);
    assert.ok(canaryReturn, 'must find canary return json');
    assert.ok(!/"user_id"/.test(canaryReturn![0]), 'canary json must not expose user_id as a key');
  });

  // 11. Bulk public response contains no user_id
  it('bulk public response contains no user_id (uses toPublic)', () => {
    const match = funcSrc.match(/results:\s*results\.map\(toPublic\)/);
    assert.ok(match, 'bulk response must use results.map(toPublic)');
    // Verify the bulk return json does not directly expose user_id as a response key
    const bulkReturn = funcSrc.match(/mode:\s*["']identity_repair["'][\s\S]*?canary_passed:\s*true[\s\S]*?return\s+json\(\s*\{[\s\S]*?\}\s*\)/);
    assert.ok(bulkReturn, 'must find bulk success return json');
    assert.ok(!/"user_id"/.test(bulkReturn![0]), 'bulk json must not expose user_id as a key');
  });

  // 12. conflict/orphan UUIDs never returned
  it('no conflict_auth_user_id or orphan_auth_user_id in response serialization', () => {
    assert.ok(!/conflict_auth_user_id/.test(funcSrc), 'must not expose conflict_auth_user_id');
    assert.ok(!/orphan_auth_user_id/.test(funcSrc), 'must not expose orphan_auth_user_id');
  });

  // 13. UI result types contain no user_id
  it('IdentityRepairCard types contain no user_id', () => {
    const canaryResultMatch = identityRepairCardSrc.match(/interface CanaryResult\s*\{[\s\S]*?\}/);
    assert.ok(canaryResultMatch, 'must have CanaryResult interface');
    assert.ok(!/user_id/.test(canaryResultMatch![0]), 'CanaryResult must not have user_id');
  });

  // 14. Canary-first bulk remains non-bypassable
  it('identity_repair canary-first non-bypassable', () => {
    const repairSection = funcSrc.match(/mode\s*===\s*["']identity_repair["'][\s\S]*$/);
    const section = repairSection![0];
    assert.ok(/CANARY_FAILED/.test(section), 'must return CANARY_FAILED');
    assert.ok(!/body\.skip_canary/.test(funcSrc), 'no skip_canary');
    assert.ok(!/body\.force/.test(funcSrc), 'no force');
    assert.ok(!/body\.canary_passed/.test(funcSrc), 'no canary_passed from client');
  });

  // 15. no .from("auth.identities")
  it('no .from("auth.identities") Data API reads', () => {
    assert.ok(!/\.from\(\s*["']auth\.identities["']/.test(funcSrc), 'must not read auth.identities via Data API');
  });

  // 16. no direct Auth SQL write
  it('no direct SQL Auth writes', () => {
    assert.ok(!/UPDATE\s+auth\./i.test(funcSrc), 'no UPDATE on auth schema');
    assert.ok(!/INSERT\s+INTO\s+auth\./i.test(funcSrc), 'no INSERT INTO auth schema');
    assert.ok(!/DELETE\s+FROM\s+auth\./i.test(funcSrc), 'no DELETE FROM auth schema');
  });

  // 17. Resolver unchanged
  it('resolver not referenced in edge function', () => {
    assert.ok(!/resolve_phone_password_login_v1/.test(funcSrc), 'must not reference resolver');
  });

  // Fix 4 additional: Internal vs Public types separated
  it('InternalRepairResult has user_id, PublicRepairResult does not', () => {
    const internalMatch = funcSrc.match(/interface InternalRepairResult\s*\{[\s\S]*?\}/);
    const publicMatch = funcSrc.match(/interface PublicRepairResult\s*\{[\s\S]*?\}/);
    assert.ok(internalMatch, 'must have InternalRepairResult');
    assert.ok(publicMatch, 'must have PublicRepairResult');
    assert.ok(/user_id/.test(internalMatch![0]), 'InternalRepairResult must have user_id');
    assert.ok(!/user_id/.test(publicMatch![0]), 'PublicRepairResult must not have user_id');
  });

  // Fix 4 additional: toPublic function strips user_id
  it('toPublic function exists and strips user_id', () => {
    assert.ok(/function toPublic/.test(funcSrc), 'must have toPublic function');
    const toPublicMatch = funcSrc.match(/function toPublic[\s\S]*?return\s*\{[^}]*\}/);
    assert.ok(toPublicMatch, 'must find toPublic return');
    assert.ok(!/user_id/.test(toPublicMatch![0]), 'toPublic must not return user_id');
  });

  // Fix 4 additional: IDENTITY_STATE_CONFLICT logged to repair queue
  it('IDENTITY_STATE_CONFLICT logged to repair queue', () => {
    assert.ok(/IDENTITY_STATE_CONFLICT/.test(funcSrc), 'must have IDENTITY_STATE_CONFLICT error code');
    const conflictMatch = funcSrc.match(/IDENTITY_STATE_CONFLICT[\s\S]*?logRepair/);
    assert.ok(conflictMatch, 'IDENTITY_STATE_CONFLICT must be logged to repair queue');
  });

  // Fix 4 additional: IDENTITY_VERIFY_UNAVAILABLE logged before write
  it('IDENTITY_VERIFY_UNAVAILABLE logged before any write', () => {
    const repairSection = funcSrc.match(/async function repairOneIdentity[\s\S]*?^}/m);
    const section = repairSection![0];
    const unavailableIdx = section.indexOf('IDENTITY_VERIFY_UNAVAILABLE');
    const fetchIdx = section.indexOf('fetch(');
    assert.ok(unavailableIdx > -1 && unavailableIdx < fetchIdx, 'IDENTITY_VERIFY_UNAVAILABLE must be logged before fetch');
  });

  // Fix 4 additional: dry_run returns only ok, mode, summary
  it('dry_run returns only ok, mode, summary', () => {
    const match = funcSrc.match(/return\s+json\(\s*\{\s*ok:\s*true,\s*mode:\s*["']dry_run["'],\s*summary\s*\}\s*\)/);
    assert.ok(match, 'must find dry_run success return with ok, mode, summary only');
    const ret = match![0];
    assert.ok(/ok/.test(ret), 'must have ok');
    assert.ok(/mode/.test(ret), 'must have mode');
    assert.ok(/summary/.test(ret), 'must have summary');
  });

  // Fix 4 additional: bulk response includes skipped
  it('bulk response includes skipped count', () => {
    const repairSection = funcSrc.match(/mode\s*===\s*["']identity_repair["'][\s\S]*$/);
    const section = repairSection![0];
    assert.ok(/skipped/.test(section), 'bulk response must include skipped count');
  });

  // Fix 4 additional: execute mode also uses toPublic
  it('execute mode uses toPublic for results', () => {
    const match = funcSrc.match(/mode:\s*["']execute["'][\s\S]*?results:\s*results\.map\(toPublic\)/);
    assert.ok(match, 'execute mode must use results.map(toPublic)');
  });

  // Fix 4 additional: admin gate preserved
  it('admin gate preserved (requireFullAuthAccess + is_admin + is_active)', () => {
    assert.ok(/requireFullAuthAccess/.test(funcSrc), 'must require full auth access');
    assert.ok(/is_admin/.test(funcSrc), 'must check is_admin');
    assert.ok(/is_active/.test(funcSrc), 'must check is_active');
  });

  // Fix 4 additional: no assert.ok(true)
  it('no formal assert.ok(true) assertions', () => {
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
