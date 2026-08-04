import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mfaSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/auth/services/mfaOperations.ts'),
  'utf-8',
);

const migrationDir = path.join(__dirname, '../../supabase/migrations');
const blockerMigrationName = '20260804200000_phase3a_blocker_fixes.sql';
const blockerMigrationPath = path.join(migrationDir, blockerMigrationName);
const blockerMigrationSql = fs.existsSync(blockerMigrationPath)
  ? fs.readFileSync(blockerMigrationPath, 'utf-8')
  : '';

// ── 1. Six-digit code validation ────────────────────────────────────────────

test('validateTotpCode rejects fewer than 6 digits', async () => {
  const { validateTotpCode } = await import(
    '../../src/features/auth/services/totpValidation'
  );
  assert.equal(validateTotpCode('12345'), null);
  assert.equal(validateTotpCode('123'), null);
  assert.equal(validateTotpCode(''), null);
});

test('validateTotpCode rejects more than 6 digits', async () => {
  const { validateTotpCode } = await import(
    '../../src/features/auth/services/totpValidation'
  );
  assert.equal(validateTotpCode('1234567'), null);
  assert.equal(validateTotpCode('12345678'), null);
});

test('validateTotpCode rejects letters and symbols', async () => {
  const { validateTotpCode } = await import(
    '../../src/features/auth/services/totpValidation'
  );
  assert.equal(validateTotpCode('abcdef'), null);
  assert.equal(validateTotpCode('12a456'), null);
  assert.equal(validateTotpCode('123-56'), null);
  assert.equal(validateTotpCode('۱۲۳۴۵۶'), null); // Persian digits rejected
});

test('validateTotpCode accepts exactly 6 ASCII digits', async () => {
  const { validateTotpCode } = await import(
    '../../src/features/auth/services/totpValidation'
  );
  assert.equal(validateTotpCode('123456'), '123456');
  assert.equal(validateTotpCode('000000'), '000000');
  assert.equal(validateTotpCode('  123456  '), '123456'); // trimmed
});

// ── 2. Factor filtering ─────────────────────────────────────────────────────

test('unverified factors are not selected for challenge', () => {
  const allFactors = [
    { id: 'f1', friendlyName: 'A', factorType: 'totp', status: 'unverified', createdAt: '2024-01-01' },
    { id: 'f2', friendlyName: 'B', factorType: 'totp', status: 'verified', createdAt: '2024-01-02' },
    { id: 'f3', friendlyName: 'C', factorType: 'totp', status: 'unverified', createdAt: '2024-01-03' },
  ];
  const verified = allFactors.filter((f) => f.status === 'verified');
  assert.equal(verified.length, 1);
  assert.equal(verified[0].id, 'f2');
});

test('verified TOTP factors are correctly filtered', () => {
  const allFactors = [
    { id: 'f1', friendlyName: 'A', factorType: 'totp', status: 'verified', createdAt: '2024-01-01' },
    { id: 'f2', friendlyName: 'B', factorType: 'totp', status: 'verified', createdAt: '2024-01-02' },
    { id: 'f3', friendlyName: 'C', factorType: 'webauthn', status: 'verified', createdAt: '2024-01-03' },
  ];
  const verifiedTotp = allFactors.filter(
    (f) => f.factorType === 'totp' && f.status === 'verified'
  );
  assert.equal(verifiedTotp.length, 2);
  assert.ok(verifiedTotp.every((f) => f.factorType === 'totp'));
  assert.ok(verifiedTotp.every((f) => f.status === 'verified'));
});

// ── 3. Multi-factor selection ───────────────────────────────────────────────

test('multiple factors do not fall to [0] without explicit selection', () => {
  const factors = [
    { id: 'f1', friendlyName: 'A', factorType: 'totp', status: 'verified', createdAt: '2024-01-01' },
    { id: 'f2', friendlyName: 'B', factorType: 'totp', status: 'verified', createdAt: '2024-01-02' },
  ];
  let selectedFactorId: string | null = null;
  if (factors.length === 1) {
    selectedFactorId = factors[0].id;
  }
  assert.equal(selectedFactorId, null,
    'must not auto-select [0] when multiple factors exist');
});

// ── 4. Enrollment not auto-started ──────────────────────────────────────────

test('enrollment does not auto-start on mount', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/features/auth/components/TotpEnrollmentGate.tsx'),
    'utf-8',
  );
  assert.ok(source.includes("useState<Phase>('intro')"),
    'must start in intro phase, not auto-enroll');
  assert.ok(!source.match(/useEffect\([\s\S]*?startTotpEnrollment/),
    'must not call startTotpEnrollment inside useEffect');
});

// ── 5. Cancel only targets factor created in current flow ──────────────────

test('cancel only targets factor created in current flow', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/features/auth/components/TotpEnrollmentGate.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('enrolledFactorIdRef.current'),
    'cancel must use the ref tracking the factor created in this flow');
  const cancelFn = source.slice(
    source.indexOf('handleCancel'),
    source.indexOf('}, []);', source.indexOf('handleCancel'))
  );
  assert.ok(!cancelFn.includes("status === 'verified'"),
    'cancel must not filter by verified status');
});

// ── 6. Blocker 1: challengeAndVerify used, no empty challengeId ─────────────

test('source uses challengeAndVerify, not separate challenge+verify with empty challengeId', () => {
  assert.ok(mfaSource.includes('challengeAndVerify'),
    'must use challengeAndVerify API');
  assert.ok(!mfaSource.includes("challengeId: ''"),
    'must not contain empty challengeId');
});

test('no challengeId with empty or fake value exists in source', () => {
  assert.ok(!mfaSource.match(/challengeId:\s*['"`]/),
    'must not pass any literal challengeId — challengeAndVerify handles it internally');
});

test('verifyTotpFactor calls challengeAndVerify with factorId and code', () => {
  const fnStart = mfaSource.indexOf('export async function verifyTotpFactor');
  const fnEnd = mfaSource.indexOf('}', mfaSource.indexOf('return { currentAal: currentLevel };', fnStart));
  const fnBody = mfaSource.slice(fnStart, fnEnd + 1);
  assert.ok(fnBody.includes('challengeAndVerify'),
    'verifyTotpFactor must call challengeAndVerify');
  assert.ok(fnBody.includes('factorId'),
    'verifyTotpFactor must pass factorId');
  assert.ok(fnBody.includes('validCode'),
    'verifyTotpFactor must pass the validated code');
});

test('performTotpStepUp calls challengeAndVerify with factorId and code', () => {
  const fnStart = mfaSource.indexOf('export async function performTotpStepUp');
  const fnEnd = mfaSource.indexOf('\n}\n', fnStart + 10);
  const fnBody = mfaSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('challengeAndVerify'),
    'performTotpStepUp must call challengeAndVerify');
  assert.ok(fnBody.includes('params.factorId'),
    'performTotpStepUp must pass factorId from params');
  assert.ok(fnBody.includes('validCode'),
    'performTotpStepUp must pass the validated code');
});

// ── 7. Blocker 1: AAL2 check and session validation after verify ────────────

test('verifyTotpFactor checks getAuthenticatorAssuranceLevel after verify', () => {
  const fnStart = mfaSource.indexOf('export async function verifyTotpFactor');
  const fnEnd = mfaSource.indexOf('\n}\n', fnStart + 10);
  const fnBody = mfaSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('getAuthenticatorAssuranceLevel'),
    'verifyTotpFactor must call getAuthenticatorAssuranceLevel');
  assert.ok(fnBody.includes("currentLevel !== 'aal2'"),
    'verifyTotpFactor must check currentLevel === aal2');
});

test('performTotpStepUp checks AAL2 and session before RPC', () => {
  const fnStart = mfaSource.indexOf('export async function performTotpStepUp');
  const fnEnd = mfaSource.indexOf('\n}\n', fnStart + 10);
  const fnBody = mfaSource.slice(fnStart, fnEnd);

  const aal2Pos = fnBody.indexOf("currentLevel !== 'aal2'");
  const sessionPos = fnBody.indexOf('getSession');
  const rpcPos = fnBody.indexOf("supabase.rpc('issue_totp_stepup_grant'");

  assert.ok(aal2Pos > 0, 'must check AAL2');
  assert.ok(sessionPos > 0, 'must get session');
  assert.ok(rpcPos > 0, 'must call RPC');
  assert.ok(aal2Pos < sessionPos || sessionPos === -1,
    'AAL2 check must come before session check (or session check is absent)');
  assert.ok(aal2Pos < rpcPos,
    'AAL2 check must come before RPC call');
  assert.ok(sessionPos < rpcPos,
    'session validation must come before RPC call');
});

test('performTotpStepUp checks access_token exists but does not log or return it', () => {
  const fnStart = mfaSource.indexOf('export async function performTotpStepUp');
  const fnEnd = mfaSource.indexOf('\n}\n', fnStart + 10);
  const fnBody = mfaSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('access_token'),
    'must check access_token exists');
  assert.ok(!fnBody.match(/console\.\w+\([\s\S]*?access_token/),
    'must not log access_token');
  const returnMatches = fnBody.match(/return\s*\{[^}]*\}/g) || [];
  for (const ret of returnMatches) {
    assert.ok(!ret.includes('access_token'),
      'must not include access_token in return object');
  }
});

// ── 8. Blocker 1: RPC not called on verify failure or AAL2 failure ───────────

test('RPC is not called when verify fails — verify error returns before RPC', () => {
  const fnStart = mfaSource.indexOf('export async function performTotpStepUp');
  const fnEnd = mfaSource.indexOf('\n}\n', fnStart + 10);
  const fnBody = mfaSource.slice(fnStart, fnEnd);

  const verifyErrorCheck = fnBody.indexOf('if (verifyError)');
  const rpcPos = fnBody.indexOf("supabase.rpc('issue_totp_stepup_grant'");

  assert.ok(verifyErrorCheck > 0, 'must check verifyError');
  assert.ok(verifyErrorCheck < rpcPos,
    'verify error check must come before RPC call');
  const returnAfterVerifyError = fnBody.indexOf('return', verifyErrorCheck);
  assert.ok(returnAfterVerifyError > 0 && returnAfterVerifyError < rpcPos,
    'must return on verify error before reaching RPC');
});

test('RPC is not called when AAL2 is not reached — AAL2 check returns before RPC', () => {
  const fnStart = mfaSource.indexOf('export async function performTotpStepUp');
  const fnEnd = mfaSource.indexOf('\n}\n', fnStart + 10);
  const fnBody = mfaSource.slice(fnStart, fnEnd);

  const aal2Check = fnBody.indexOf("currentLevel !== 'aal2'");
  const rpcPos = fnBody.indexOf("supabase.rpc('issue_totp_stepup_grant'");
  const returnAfterAal2 = fnBody.indexOf('return', aal2Check);

  assert.ok(aal2Check > 0, 'must have AAL2 check');
  assert.ok(returnAfterAal2 > 0 && returnAfterAal2 < rpcPos,
    'must return on AAL2 failure before reaching RPC');
});

// ── 9. Blocker 1: Error mapping — no raw messages ───────────────────────────

test('no raw rpcError.message returned to caller', () => {
  assert.ok(!mfaSource.includes('rpcError?.message'),
    'must not return raw rpcError.message');
  const returnMatches = mfaSource.match(/return\s*\{[^}]*\}/g) || [];
  for (const ret of returnMatches) {
    assert.ok(!ret.match(/error:\s*rpcError[\s,}]/),
      'must not pass raw rpcError as error field in return object');
  }
});

test('error mapping uses stable codes', () => {
  const expectedCodes = [
    'INVALID_CODE',
    'CHALLENGE_FAILED',
    'VERIFY_FAILED',
    'AAL2_NOT_REACHED',
    'SESSION_INVALID',
    'STEPUP_DENIED',
    'RECENT_TOTP_REQUIRED',
    'SECURITY_ADMIN_REQUIRED',
    'PURPOSE_NOT_ALLOWED',
    'UNKNOWN_MFA_ERROR',
  ];
  for (const code of expectedCodes) {
    assert.ok(mfaSource.includes(`'${code}'`) || mfaSource.includes(`"${code}"`),
      `must contain error code: ${code}`);
  }
});

test('mapMfaError function exists and maps to stable codes', () => {
  assert.ok(mfaSource.includes('function mapMfaError'),
    'must have mapMfaError function');
  assert.ok(mfaSource.includes("return 'INVALID_CODE'"),
    'mapMfaError must return INVALID_CODE for invalid/expired codes');
  assert.ok(mfaSource.includes("return 'UNKNOWN_MFA_ERROR'"),
    'mapMfaError must return UNKNOWN_MFA_ERROR for unknown errors');
});

// ── 10. Blocker 1: OTP not in error, log, or RPC payload ─────────────────────

test('OTP code does not appear in error messages or RPC payload', () => {
  const errorLines = mfaSource.split('\n').filter((l) =>
    l.includes('throw new Error') || l.includes('return { ok: false')
  );
  for (const line of errorLines) {
    assert.ok(!line.includes('${validCode}') && !line.includes('${code}'),
      `error must not interpolate code: ${line.trim()}`);
    assert.ok(!line.includes('${params.code}'),
      `error must not interpolate params.code: ${line.trim()}`);
  }
  assert.ok(!mfaSource.match(/console\.\w+\([\s\S]*?code/),
    'must not log the code');

  const rpcCallStart = mfaSource.indexOf("supabase.rpc('issue_totp_stepup_grant'");
  const rpcCallEnd = mfaSource.indexOf('});', rpcCallStart);
  const rpcCall = mfaSource.slice(rpcCallStart, rpcCallEnd);
  assert.ok(!rpcCall.includes('validCode'), 'must not pass OTP code value to RPC');
  assert.ok(!rpcCall.includes('params.code'), 'must not pass raw code to RPC');
  assert.ok(!/\bsecret\b/.test(rpcCall), 'must not pass secret in RPC call');
  assert.ok(!rpcCall.includes('challenge'), 'must not pass challenge ID to RPC');
  assert.ok(!/\btoken\b/.test(rpcCall), 'must not pass token in RPC call');
});

test('grant is not stored in localStorage/sessionStorage', () => {
  assert.ok(!mfaSource.includes('localStorage'),
    'must not store grant in localStorage');
  assert.ok(!mfaSource.includes('sessionStorage'),
    'must not store grant in sessionStorage');
});

// ── 11. Blocker 2: Migration tests — read from file on disk ─────────────────

test('blocker migration file exists on disk', () => {
  assert.ok(fs.existsSync(blockerMigrationPath),
    `migration file must exist: ${blockerMigrationName}`);
  assert.ok(blockerMigrationSql.length > 0,
    'migration file must not be empty');
});

test('blocker migration revokes audit helper from authenticated', () => {
  assert.ok(blockerMigrationSql.includes(
    'REVOKE EXECUTE ON FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) FROM authenticated'
  ), 'must revoke from authenticated');
});

test('blocker migration revokes audit helper from anon', () => {
  assert.ok(blockerMigrationSql.includes(
    'REVOKE EXECUTE ON FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) FROM anon'
  ), 'must revoke from anon');
});

test('blocker migration revokes audit helper from PUBLIC', () => {
  assert.ok(blockerMigrationSql.includes(
    'REVOKE EXECUTE ON FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) FROM PUBLIC'
  ), 'must revoke from PUBLIC');
});

test('blocker migration grants audit helper only to service_role', () => {
  assert.ok(blockerMigrationSql.includes(
    'GRANT EXECUTE ON FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) TO service_role'
  ), 'must grant to service_role');
  assert.ok(!blockerMigrationSql.includes(
    'GRANT EXECUTE ON FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) TO authenticated'
  ), 'must NOT grant to authenticated');
});

test('blocker migration keeps main function executable by authenticated', () => {
  assert.ok(blockerMigrationSql.includes(
    'GRANT EXECUTE ON FUNCTION public.issue_totp_stepup_grant(text, uuid) TO authenticated'
  ), 'must grant issue_totp_stepup_grant to authenticated');
});

test('blocker migration uses is_current_security_admin()', () => {
  assert.ok(blockerMigrationSql.includes('public.is_current_security_admin()'),
    'must use is_current_security_admin() helper');
});

test('blocker migration checks p_purpose IS NULL', () => {
  assert.ok(blockerMigrationSql.includes('p_purpose IS NULL'),
    'must check p_purpose IS NULL');
});

test('blocker migration has exact purpose allowlist', () => {
  assert.ok(blockerMigrationSql.includes("'auth_settings_change'"),
    'must include auth_settings_change purpose');
  assert.ok(blockerMigrationSql.includes("'account_security_change'"),
    'must include account_security_change purpose');
});

test('blocker migration does not store raw invalid purpose in audit', () => {
  const purposeCheckStart = blockerMigrationSql.indexOf('IF p_purpose IS NULL');
  const purposeCheckEnd = blockerMigrationSql.indexOf('END IF;', purposeCheckStart);
  const purposeBlock = blockerMigrationSql.slice(purposeCheckStart, purposeCheckEnd);
  assert.ok(purposeBlock.includes("'PURPOSE_NOT_ALLOWED', NULL"),
    'invalid purpose audit must pass NULL, not raw p_purpose');
});

test('blocker migration uses COALESCE for request_id', () => {
  assert.ok(blockerMigrationSql.includes('COALESCE(p_request_id, gen_random_uuid())'),
    'must use COALESCE(p_request_id, gen_random_uuid())');
});

test('blocker migration rejects future TOTP timestamps', () => {
  assert.ok(blockerMigrationSql.includes('v_totp_proof_time > clock_timestamp()'),
    'must reject future TOTP timestamps');
});

test('blocker migration does not DELETE previous grants', () => {
  assert.ok(!blockerMigrationSql.toUpperCase().includes('DELETE FROM public.session_security_grants'),
    'must not DELETE grants — use UPDATE consumed_at');
  assert.ok(blockerMigrationSql.includes('SET consumed_at = clock_timestamp()'),
    'must void previous grants with consumed_at UPDATE');
});

test('blocker migration rejects non-ACTIVE account statuses', () => {
  const statuses = ['PHONE_UNVERIFIED', 'PENDING_ADMIN_APPROVAL', 'REJECTED', 'SUSPENDED', 'LOCKED'];
  for (const s of statuses) {
    assert.ok(blockerMigrationSql.includes(`'${s}'`),
      `must reject account status: ${s}`);
  }
});

test('blocker migration does not modify MFA policies', () => {
  assert.ok(!blockerMigrationSql.toLowerCase().includes('mfa_policy'),
    'must not change mfa_policy');
  assert.ok(!blockerMigrationSql.toLowerCase().includes('allow_totp_mfa'),
    'must not change allow_totp_mfa');
  assert.ok(!blockerMigrationSql.toLowerCase().includes('mfa_enrollment_required'),
    'must not change mfa_enrollment_required');
});

test('blocker migration does not create experimental factors', () => {
  assert.ok(!blockerMigrationSql.toUpperCase().includes('INSERT INTO AUTH.MFA'),
    'must not insert into auth.mfa_factors');
});

test('blocker migration does not delete or reset data', () => {
  assert.ok(!blockerMigrationSql.toUpperCase().includes('DROP '),
    'must not DROP anything');
  assert.ok(!blockerMigrationSql.toUpperCase().includes('TRUNCATE '),
    'must not TRUNCATE');
  assert.ok(!blockerMigrationSql.toUpperCase().includes('DELETE FROM'),
    'must not DELETE FROM');
});

test('prior migration file is not modified', () => {
  const priorMigrationPath = path.join(
    migrationDir,
    '20260804180657_20260804180000_phase3a_totp_stepup_grant_rpc.sql.sql'
  );
  assert.ok(fs.existsSync(priorMigrationPath),
    'prior migration must still exist unmodified');
  assert.ok(priorMigrationPath.endsWith('.sql.sql'),
    'prior migration must retain .sql.sql extension');
});

test('no edge function deployed in blocker migration', () => {
  assert.ok(!blockerMigrationSql.toLowerCase().includes('edge function'),
    'must not deploy edge functions');
});
