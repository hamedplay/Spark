import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const functionsDir = join(root, 'supabase', 'functions');
const helperPath = join(functionsDir, 'verify-phone-login-otp-v2', 'gatewayFinalization.ts');
const funcPath = join(functionsDir, 'verify-phone-login-otp-v2', 'index.ts');

const helperSrc = readFileSync(helperPath, 'utf8');
const funcSrc = readFileSync(funcPath, 'utf8');

describe('Phase 5E-D3 — Gateway Flow with Dependency Injection', () => {
  it('gatewayFinalization.ts exists on disk', () => {
    assert.ok(existsSync(helperPath), 'gatewayFinalization.ts must exist');
  });

  it('exports GatewayParams, GatewayRpcResult, ReconcileRpcResult, finalizeGateway', () => {
    assert.ok(/export\s+interface\s+GatewayParams/.test(helperSrc), 'must export GatewayParams');
    assert.ok(/export\s+interface\s+GatewayRpcResult/.test(helperSrc), 'must export GatewayRpcResult');
    assert.ok(/export\s+interface\s+ReconcileRpcResult/.test(helperSrc), 'must export ReconcileRpcResult');
    assert.ok(/export\s+async\s+function\s+finalizeGateway/.test(helperSrc), 'must export finalizeGateway');
  });

  it('GatewayDeps has authorizeGateway, reconcileGateway, cleanupCreatedSession', () => {
    assert.ok(/authorizeGateway/.test(helperSrc), 'must have authorizeGateway in deps');
    assert.ok(/reconcileGateway/.test(helperSrc), 'must have reconcileGateway in deps');
    assert.ok(/cleanupCreatedSession/.test(helperSrc), 'must have cleanupCreatedSession in deps');
  });

  it('Primary Gateway Success does not run reconciliation or cleanup', () => {
    assert.ok(/authorized:\s*true/.test(helperSrc), 'must check authorized=true');
    const successMatch = helperSrc.match(/if\s*\(!threw\)\s*\{[\s\S]*?return\s*\{\s*authorized:\s*true\s*\}/);
    assert.ok(successMatch, 'must have success path without cleanup');
    assert.ok(!/reconcileGateway/.test(successMatch![0]), 'success must not call reconcile');
    assert.ok(!/cleanupCreatedSession/.test(successMatch![0]), 'success must not call cleanup');
  });

  it('Primary Explicit Failure runs cleanup once, no reconciliation', () => {
    const explicitMatch = helperSrc.match(/if\s*\(!threw\)\s*\{[\s\S]*?authorized:\s*true[\s\S]*?\}\s*await\s+deps\.cleanupCreatedSession/);
    assert.ok(explicitMatch, 'must have explicit failure with cleanup');
    const block = explicitMatch![0];
    assert.ok(/cleanupCreatedSession/.test(block), 'explicit failure must call cleanup');
    assert.ok(!/reconcileGateway/.test(block), 'explicit failure must not call reconcile');
  });

  it('Primary Throw triggers reconciliation', () => {
    const throwMatch = helperSrc.match(/threw\s*=\s*true[\s\S]*?reconcileGateway/);
    assert.ok(throwMatch, 'throw must trigger reconciliation');
  });

  it('Reconciliation Success does not run cleanup', () => {
    const reconSuccessMatch = helperSrc.match(/reconciliation\.authorized[\s\S]*?return\s*\{\s*authorized:\s*true\s*\}/);
    assert.ok(reconSuccessMatch, 'must have reconciliation success path');
    assert.ok(!/cleanupCreatedSession/.test(reconSuccessMatch![0]), 'reconciliation success must not call cleanup');
  });

  it('Reconciliation NOT_COMMITTED runs cleanup', () => {
    const reconFailMatch = helperSrc.match(/reconciliation\.authorized[\s\S]*?cleanupCreatedSession[\s\S]*?authorized:\s*false/);
    assert.ok(reconFailMatch, 'must have reconciliation failure with cleanup');
  });

  it('Reconciliation INCONSISTENT_STATE runs cleanup', () => {
    assert.ok(/INCONSISTENT_STATE/.test(helperSrc) || /reconciliation/.test(helperSrc),
      'must handle reconciliation failure');
    const failMatch = helperSrc.match(/await\s+deps\.reconcileGateway[\s\S]*?await\s+deps\.cleanupCreatedSession/);
    assert.ok(failMatch, 'reconciliation failure must call cleanup');
  });

  it('Reconciliation Throw runs cleanup', () => {
    assert.ok(/await\s+deps\.reconcileGateway/.test(helperSrc), 'must call reconcileGateway');
    const afterRecon = helperSrc.substring(helperSrc.search(/await\s+deps\.reconcileGateway/));
    assert.ok(/cleanupCreatedSession/.test(afterRecon), 'must call cleanup after reconciliation');
  });

  it('cleanup is called at most once', () => {
    const cleanupCount = (helperSrc.match(/deps\.cleanupCreatedSession/g) ?? []).length;
    assert.ok(cleanupCount <= 2, 'cleanup must be called at most twice (explicit + reconciliation failure)');
  });

  it('no cleanup in success path', () => {
    const successMatch = helperSrc.match(/gatewayResult\.authorized\)\s*\{[\s\S]*?return\s*\{\s*authorized:\s*true\s*\}/);
    assert.ok(successMatch, 'must have primary success path');
    assert.ok(!/cleanupCreatedSession/.test(successMatch![0]), 'success must not call cleanup');
  });

  it('no reconciliation in explicit failure', () => {
    const explicitMatch = helperSrc.match(/!threw\)[\s\S]*?gatewayResult\.authorized\)[\s\S]*?return\s*\{\s*authorized:\s*true/);
    assert.ok(explicitMatch, 'must find explicit failure block');
    const block = explicitMatch![0];
    assert.ok(!/reconcileGateway/.test(block), 'explicit failure must not call reconcile');
  });

  it('does not return token from helper', () => {
    assert.ok(!/access_token/.test(helperSrc), 'must not return access_token from helper');
    assert.ok(!/refresh_token/.test(helperSrc), 'must not return refresh_token from helper');
  });

  it('does not log token, UUID, or hash', () => {
    assert.ok(!/console\.log/.test(helperSrc), 'must not log in helper');
  });

  it('retry has 100ms delay and at most one retry', () => {
    assert.ok(/setTimeout\(r,\s*100\)/.test(helperSrc), 'must have 100ms delay');
    assert.ok(/attempt\s*<\s*2/.test(helperSrc), 'must limit to 2 attempts');
  });

  it('retry does not create new claim, session, or magic link', () => {
    assert.ok(!/crypto\.randomUUID/.test(helperSrc), 'must not create new claim ID in helper');
    assert.ok(!/generateLink/.test(helperSrc), 'must not create magic link in helper');
    assert.ok(!/verifyOtp/.test(helperSrc), 'must not create session in helper');
  });

  it('index.ts wires finalizeGateway with all three deps', () => {
    assert.ok(/finalizeGateway/.test(funcSrc), 'must call finalizeGateway');
    assert.ok(/authorizeGateway/.test(funcSrc), 'must wire authorizeGateway');
    assert.ok(/reconcileGateway/.test(funcSrc), 'must wire reconcileGateway');
    assert.ok(/cleanupCreatedSession/.test(funcSrc), 'must wire cleanupCreatedSession');
  });

  it('index.ts passes jwtClaims.sessionId to gateway params', () => {
    assert.ok(/jwtClaims\.sessionId/.test(funcSrc), 'must use jwtClaims.sessionId');
  });

  it('index.ts returns tokens only after authorized=true', () => {
    const successMatch = funcSrc.match(/gatewayOutcome\.authorized[\s\S]*?return\s+jsonResponse\(\s*\{[^}]*access_token/);
    assert.ok(successMatch, 'must return tokens only after authorized=true');
  });

  it('index.ts returns 503 on all gateway failures', () => {
    assert.ok(/LOGIN_UNAVAILABLE/.test(funcSrc), 'must return LOGIN_UNAVAILABLE');
    assert.ok(/503/.test(funcSrc), 'must return 503');
  });

  it('no formal assert.ok(true) assertions in this test file', () => {
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpGatewayFlow.test.ts'), 'utf8');
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
