import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const helperSrc = readFileSync(
  join(root, 'supabase', 'functions', '_shared', 'authorizeGatewaySession.ts'),
  'utf8',
);

const verifyRegSrc = readFileSync(
  join(root, 'supabase', 'functions', 'verify-public-registration-otp', 'index.ts'),
  'utf8',
);

const requestOtpSrc = readFileSync(
  join(root, 'supabase', 'functions', 'request-phone-login-otp', 'index.ts'),
  'utf8',
);

const verifyOtpSrc = readFileSync(
  join(root, 'supabase', 'functions', 'verify-phone-login-otp', 'index.ts'),
  'utf8',
);

describe('Phase 5B-2 — Session Issuers', () => {

  describe('authorizeGatewaySession helper', () => {
    it('validates sub claim matches expected user id', () => {
      assert.ok(helperSrc.includes('jwtPayload.sub !== expectedUserId'), 'must check sub matches expectedUserId');
    });

    it('validates session_id is a UUID', () => {
      assert.ok(helperSrc.includes('isValidUuid(sessionId)'), 'must validate session_id is UUID');
    });

    it('validates AMR includes password method', () => {
      assert.ok(helperSrc.includes('hasPasswordAmr'), 'must check AMR for password method');
      assert.ok(helperSrc.includes("item?.method ==="), 'must check method=password in AMR');
      assert.ok(helperSrc.includes('"password"') || helperSrc.includes("'password'"), 'must check password method value');
    });

    it('calls admin.auth.getUser with access token', () => {
      assert.ok(helperSrc.includes('adminClient.auth.getUser(accessToken)'), 'must validate token with admin');
    });

    it('calls authorize_password_gateway_session_v1 RPC with public_registration', () => {
      assert.ok(helperSrc.includes('authorize_password_gateway_session_v1'), 'must call authorize RPC');
      assert.ok(helperSrc.includes("loginMethod"), 'must pass loginMethod');
      assert.ok(helperSrc.includes('p_login_method: loginMethod'), 'must pass login_method parameter');
    });

    it('returns authorized=true only when RPC confirms', () => {
      assert.ok(helperSrc.includes('authRow.authorized !== true'), 'must check authorized !== true');
      assert.ok(helperSrc.includes('return { authorized: true }'), 'must return authorized=true on success');
    });

    it('does not log tokens, hashes, emails, or IPs', () => {
      assert.ok(!helperSrc.includes('console.log'), 'must not log sensitive data');
    });
  });

  describe('revokeLocalSession helper', () => {
    it('calls logout with scope=local', () => {
      assert.ok(helperSrc.includes('/auth/v1/logout?scope=local'), 'must call logout with scope=local');
    });

    it('suppresses logout errors', () => {
      assert.ok(helperSrc.includes('catch'), 'must catch logout errors');
      assert.ok(!helperSrc.includes('throw'), 'must not rethrow logout errors');
    });
  });

  describe('verify-public-registration-otp', () => {
    it('imports authorizeGatewaySession and revokeLocalSession', () => {
      assert.ok(verifyRegSrc.includes('authorizeGatewaySession'), 'must import authorizeGatewaySession');
      assert.ok(verifyRegSrc.includes('revokeLocalSession'), 'must import revokeLocalSession');
    });

    it('ALREADY_CONSUMED path runs gateway authorization', () => {
      const alreadyIdx = verifyRegSrc.indexOf('ALREADY_CONSUMED');
      const authIdx = verifyRegSrc.indexOf('authorizeGatewaySession', alreadyIdx);
      assert.ok(alreadyIdx > -1, 'must have ALREADY_CONSUMED path');
      assert.ok(authIdx > alreadyIdx, 'must call authorizeGatewaySession after ALREADY_CONSUMED');
    });

    it('new user path runs gateway authorization', () => {
      const createIdx = verifyRegSrc.indexOf('createUser');
      const authIdx = verifyRegSrc.indexOf('authorizeGatewaySession', createIdx);
      assert.ok(createIdx > -1, 'must have createUser');
      assert.ok(authIdx > createIdx, 'must call authorizeGatewaySession after createUser');
    });

    it('returns session only after authorized === true', () => {
      const authCheckIdx = verifyRegSrc.indexOf('authResult.authorized');
      const sessionReturnIdx = verifyRegSrc.indexOf('session: signInData.session', authCheckIdx);
      assert.ok(authCheckIdx > -1, 'must check authResult.authorized');
      assert.ok(sessionReturnIdx > authCheckIdx, 'must return session only after authorization');
    });

    it('revokes local session on authorization failure in ALREADY_CONSUMED', () => {
      const alreadyIdx = verifyRegSrc.indexOf('ALREADY_CONSUMED');
      const revokeIdx = verifyRegSrc.indexOf('revokeLocalSession', alreadyIdx);
      assert.ok(revokeIdx > alreadyIdx, 'must call revokeLocalSession on ALREADY_CONSUMED auth failure');
    });

    it('revokes local session on authorization failure in new user path', () => {
      const createIdx = verifyRegSrc.indexOf('createUser');
      const revokeIdx = verifyRegSrc.indexOf('revokeLocalSession', createIdx);
      assert.ok(revokeIdx > createIdx, 'must call revokeLocalSession on new user auth failure');
    });

    it('does not delete user or profile on authorization failure', () => {
      assert.ok(!verifyRegSrc.includes('deleteUser'), 'must not delete user on auth failure');
      assert.ok(!verifyRegSrc.includes('delete().eq'), 'must not delete profile on auth failure');
    });

    it('body limit uses byte length', () => {
      assert.ok(verifyRegSrc.includes('new TextEncoder().encode(body).byteLength'), 'must use byte length for body limit');
    });

    it('does not return tokens before gateway authorization', () => {
      const firstSessionReturn = verifyRegSrc.indexOf('session: signInData.session');
      const firstAuthCall = verifyRegSrc.indexOf('authorizeGatewaySession');
      assert.ok(firstAuthCall < firstSessionReturn, 'authorization must happen before session return');
    });
  });

  describe('request-phone-login-otp (disabled)', () => {
    it('returns 410 for POST', () => {
      assert.ok(requestOtpSrc.includes('410'), 'must return 410 for POST');
      assert.ok(requestOtpSrc.includes('LOGIN_ROUTE_REPLACED'), 'must return LOGIN_ROUTE_REPLACED');
    });

    it('returns 405 for non-POST methods', () => {
      assert.ok(requestOtpSrc.includes('405'), 'must return 405 for non-POST');
      assert.ok(requestOtpSrc.includes('METHOD_NOT_ALLOWED'), 'must return METHOD_NOT_ALLOWED');
    });

    it('does not call verifyOtp or signInWithPassword', () => {
      assert.ok(!requestOtpSrc.includes('verifyOtp'), 'must not call verifyOtp');
      assert.ok(!requestOtpSrc.includes('signInWithPassword'), 'must not call signInWithPassword');
    });

    it('does not send SMS or OTP', () => {
      assert.ok(!requestOtpSrc.includes('sendOtp'), 'must not send OTP');
      assert.ok(!requestOtpSrc.includes('sendSMS'), 'must not send SMS');
      assert.ok(!requestOtpSrc.includes('rahyab'), 'must not call SMS provider');
    });

    it('does not return tokens', () => {
      assert.ok(!requestOtpSrc.includes('access_token'), 'must not return access_token');
      assert.ok(!requestOtpSrc.includes('refresh_token'), 'must not return refresh_token');
    });

    it('uses exact origin match from get_phone_auth_config', () => {
      assert.ok(requestOtpSrc.includes('get_phone_auth_config'), 'must read from get_phone_auth_config');
      assert.ok(requestOtpSrc.includes('config.origins.includes(origin)'), 'must use exact origin match');
    });

    it('has no CORS wildcard', () => {
      assert.ok(!requestOtpSrc.includes('"*"'), 'must not use wildcard CORS');
    });

    it('does not consume rate limit', () => {
      assert.ok(!requestOtpSrc.includes('rate_limit'), 'must not consume rate limit');
    });
  });

  describe('verify-phone-login-otp (disabled)', () => {
    it('returns 410 for POST', () => {
      assert.ok(verifyOtpSrc.includes('410'), 'must return 410 for POST');
      assert.ok(verifyOtpSrc.includes('LOGIN_ROUTE_REPLACED'), 'must return LOGIN_ROUTE_REPLACED');
    });

    it('returns 405 for non-POST methods', () => {
      assert.ok(verifyOtpSrc.includes('405'), 'must return 405 for non-POST');
      assert.ok(verifyOtpSrc.includes('METHOD_NOT_ALLOWED'), 'must return METHOD_NOT_ALLOWED');
    });

    it('does not call verifyOtp or signInWithPassword', () => {
      assert.ok(!verifyOtpSrc.includes('verifyOtp'), 'must not call verifyOtp');
      assert.ok(!verifyOtpSrc.includes('signInWithPassword'), 'must not call signInWithPassword');
    });

    it('does not send SMS or OTP', () => {
      assert.ok(!verifyOtpSrc.includes('sendOtp'), 'must not send OTP');
      assert.ok(!verifyOtpSrc.includes('sendSMS'), 'must not send SMS');
    });

    it('does not return tokens or sessions', () => {
      assert.ok(!verifyOtpSrc.includes('access_token'), 'must not return access_token');
      assert.ok(!verifyOtpSrc.includes('refresh_token'), 'must not return refresh_token');
      assert.ok(!verifyOtpSrc.includes('session'), 'must not return session');
    });

    it('does not look up profile', () => {
      assert.ok(!verifyOtpSrc.includes('profiles'), 'must not look up profiles');
    });

    it('does not use rate limit', () => {
      assert.ok(!verifyOtpSrc.includes('rate_limit'), 'must not use rate limit');
    });

    it('does not use PHONE_RATE_LIMIT_PEPPER fallback', () => {
      assert.ok(!verifyOtpSrc.includes('PHONE_RATE_LIMIT_PEPPER'), 'must not use PHONE_RATE_LIMIT_PEPPER');
    });

    it('uses exact origin match from get_phone_auth_config', () => {
      assert.ok(verifyOtpSrc.includes('get_phone_auth_config'), 'must read from get_phone_auth_config');
      assert.ok(verifyOtpSrc.includes('config.origins.includes(origin)'), 'must use exact origin match');
    });

    it('has no CORS wildcard', () => {
      assert.ok(!verifyOtpSrc.includes('"*"'), 'must not use wildcard CORS');
    });
  });

  describe('no formal tests', () => {
    it('this file has no assert.ok(true) formal tests', () => {
      const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5SessionIssuers.test.ts'), 'utf8');
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
});
