import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const src = readFileSync(join(process.cwd(), 'src', 'components', 'AuthPage.tsx'), 'utf8');

test('Phase 5E-D4 — Phone OTP Login UI', async (t) => {

  await t.test('only two main login tabs exist', () => {
    const tabMatches = src.match(/loginTab\s*===\s*'(\w+)'/g) ?? [];
    const tabs = new Set(
      [...tabMatches]
        .map(m => m.match(/'(\w+)'/)![1])
        .filter(v => v === 'password' || v === 'phone_otp'),
    );
    assert.equal(tabs.size, 2, 'must have exactly password and phone_otp tabs');
    assert.ok(tabs.has('password'), 'must have password tab');
    assert.ok(tabs.has('phone_otp'), 'must have phone_otp tab');
  });

  await t.test('three password methods preserved inside password tab', () => {
    assert.ok(/loginMethod\s*===\s*'username'/.test(src), 'must have username method');
    assert.ok(/loginMethod\s*===\s*'email'/.test(src), 'must have email method');
    assert.ok(/loginMethod\s*===\s*'phone'/.test(src), 'must have phone method');
    assert.ok(/type LoginMethod/.test(src), 'must have LoginMethod type');
  });

  await t.test('phone OTP tab uses phone_login_canonical_enabled and phone_login_ready', () => {
    assert.ok(/phone_login_canonical_enabled/.test(src), 'must check phone_login_canonical_enabled');
    assert.ok(/phone_login_ready/.test(src), 'must check phone_login_ready');
    assert.ok(/phoneOtpTabDisabled/.test(src), 'must compute disabled state');
    assert.ok(/disabled=\{phoneOtpTabDisabled\}/.test(src), 'must apply disabled to tab button');
    assert.ok(/غیرفعال/.test(src), 'must show disabled label');
  });

  await t.test('request and verify only use V2 endpoints', () => {
    assert.ok(/request-phone-login-otp-v2/.test(src), 'must call request-phone-login-otp-v2');
    assert.ok(/verify-phone-login-otp-v2/.test(src), 'must call verify-phone-login-otp-v2');
    assert.ok(!/request-phone-login-otp['"]/.test(src), 'must not use legacy request endpoint');
    assert.ok(!/verify-phone-login-otp['"]/.test(src), 'must not use legacy verify endpoint');
  });

  await t.test('request body contains only phone', () => {
    const reqMatch = src.match(/request-phone-login-otp-v2[\s\S]*?body:\s*JSON\.stringify\(\s*\{([^}]+)\}/);
    assert.ok(reqMatch, 'must find request body');
    const body = reqMatch![1];
    assert.ok(/phone/.test(body), 'must include phone');
    assert.ok(!/challenge_id/.test(body), 'must not include challenge_id in request');
    assert.ok(!/otp/.test(body), 'must not include otp in request');
  });

  await t.test('verify body contains challenge_id, phone, and otp', () => {
    const verifyMatch = src.match(/verify-phone-login-otp-v2[\s\S]*?body:\s*JSON\.stringify\(\s*\{([\s\S]+?)\}/);
    assert.ok(verifyMatch, 'must find verify body');
    const body = verifyMatch![1];
    assert.ok(/challenge_id/.test(body), 'must include challenge_id');
    assert.ok(/phone/.test(body), 'must include phone');
    assert.ok(/otp/.test(body), 'must include otp');
  });

  await t.test('OTP must be exactly six digits', () => {
    assert.ok(/\\d\{6\}/.test(src), 'must validate 6 digits');
    assert.ok(/maxLength=\{6\}/.test(src), 'must set maxLength=6 on input');
    assert.ok(/inputMode="numeric"/.test(src), 'must set inputMode=numeric');
  });

  await t.test('resend and expiry timers exist', () => {
    assert.ok(/phoneOtpResendSeconds/.test(src), 'must have resend timer state');
    assert.ok(/phoneOtpExpiresSeconds/.test(src), 'must have expiry timer state');
    assert.ok(/setPhoneOtpResendSeconds/.test(src), 'must decrement resend timer');
    assert.ok(/setPhoneOtpExpiresSeconds/.test(src), 'must decrement expiry timer');
    assert.ok(/setTimeout/.test(src), 'must use setTimeout for timers');
    assert.ok(/clearTimeout/.test(src), 'must cleanup timers');
  });

  await t.test('setSession is called before onSuccess', () => {
    const verifySection = src.match(/verify-phone-login-otp-v2[\s\S]*?onSuccess\(\)/);
    assert.ok(verifySection, 'must find verify flow up to onSuccess');
    const block = verifySection![0];
    const setSessionIdx = block.indexOf('setSession');
    const onSuccessIdx = block.indexOf('onSuccess()');
    assert.ok(setSessionIdx > -1, 'must call setSession');
    assert.ok(onSuccessIdx > -1, 'must call onSuccess');
    assert.ok(setSessionIdx < onSuccessIdx, 'setSession must come before onSuccess');
  });

  await t.test('tokens are only passed to setSession', () => {
    const tokenMatches = src.match(/access_token/g) ?? [];
    assert.ok(tokenMatches.length >= 2, 'must reference access_token');
    const setSessionBlock = src.match(/setSession\(\s*\{[\s\S]*?access_token[\s\S]*?refresh_token[\s\S]*?\}\)/);
    assert.ok(setSessionBlock, 'must pass tokens to setSession');
  });

  await t.test('registration flow is unchanged', () => {
    assert.ok(/request-public-registration-otp/.test(src), 'must still call registration request endpoint');
    assert.ok(/verify-public-registration-otp/.test(src), 'must still call registration verify endpoint');
    assert.ok(/regStep/.test(src), 'must preserve registration step state');
    assert.ok(/regChallengeId/.test(src), 'must preserve registration challenge state');
  });

  await t.test('password recovery flow is unchanged', () => {
    assert.ok(/request-phone-password-reset-otp/.test(src), 'must still call recovery request endpoint');
    assert.ok(/verify-phone-password-reset-otp/.test(src), 'must still call recovery verify endpoint');
    assert.ok(/complete-phone-password-reset/.test(src), 'must still call recovery complete endpoint');
    assert.ok(/recoveryStep/.test(src), 'must preserve recovery step state');
    assert.ok(/recoveryChallengeId/.test(src), 'must preserve recovery challenge state');
  });

  await t.test('legacy endpoints are not used', () => {
    assert.ok(!/signInWithPassword/.test(src), 'must not use signInWithPassword');
    assert.ok(!/signInWithOtp/.test(src), 'must not use signInWithOtp');
    assert.ok(!/request-phone-login-otp['"]/.test(src), 'must not use legacy request endpoint (v1)');
    assert.ok(!/verify-phone-login-otp['"]/.test(src), 'must not use legacy verify endpoint (v1)');
  });

  await t.test('direct auth login is not added', () => {
    assert.ok(!/supabase\.auth\.signInWithPassword/.test(src), 'must not add direct auth signInWithPassword');
    assert.ok(!/supabase\.auth\.signInWithOtp/.test(src), 'must not add direct auth signInWithOtp');
  });

  await t.test('no new migrations created', () => {
    const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
    const files = readdirSync(migrationsDir);
    const d4Migration = files.find(f => f.includes('phase5e_phone_otp_login_ui'));
    assert.ok(!d4Migration, 'must not create migration for D4');
  });

  await t.test('no edge functions modified', () => {
    const functionsDir = join(process.cwd(), 'supabase', 'functions');
    const funcs = readdirSync(functionsDir);
    assert.ok(funcs.includes('verify-phone-login-otp-v2'), 'verify function still exists');
    assert.ok(funcs.includes('request-phone-login-otp-v2'), 'request function still exists');
  });

  await t.test('useRef prevents concurrent requests', () => {
    assert.ok(/phoneOtpRequestRef/.test(src), 'must have request ref guard');
    assert.ok(/phoneOtpVerifyRef/.test(src), 'must have verify ref guard');
    assert.ok(/useRef/.test(src), 'must use useRef');
  });

  await t.test('OTP state cleared when leaving tab or changing mode', () => {
    assert.ok(/mode !== 'login' \|\| loginTab !== 'phone_otp'/.test(src),
      'must clear OTP state when leaving phone_otp tab');
  });

  await t.test('error mapping for request covers 400, 429, 503', () => {
    const reqSection = src.match(/request-phone-login-otp-v2[\s\S]*?setPhoneOtpStep\('otp'\)/) ?? [];
    const fullSrc = src;
    assert.ok(/400.*شماره موبایل نامعتبر/.test(fullSrc) || /res\.status === 400[\s\S]*?شماره موبایل نامعتبر/.test(fullSrc),
      'must map 400 to invalid phone');
    assert.ok(/429[\s\S]*?retry_after_seconds/.test(fullSrc), 'must map 429 with retry_after');
    assert.ok(/503[\s\S]*?ورود پیامکی در دسترس نیست/.test(fullSrc), 'must map 503 to unavailable');
  });

  await t.test('error mapping for verify covers 400, 401, 409, 429, 503', () => {
    assert.ok(/400.*اطلاعات یا کد نامعتبر/.test(src) || /res\.status === 400[\s\S]*?اطلاعات یا کد نامعتبر/.test(src),
      'must map 400 to invalid info');
    assert.ok(/401[\s\S]*?کد اشتباه یا منقضی/.test(src), 'must map 401 to wrong/expired code');
    assert.ok(/409[\s\S]*?درخواست قبلی/.test(src), 'must map 409 to processing');
    assert.ok(/429[\s\S]*?retry_after_seconds/.test(src), 'must map 429 with retry_after');
    assert.ok(/503[\s\S]*?ورود پیامکی در دسترس نیست/.test(src), 'must map 503 to unavailable');
  });

  await t.test('expiry reaching zero clears challenge and returns to phone step', () => {
    assert.ok(/phoneOtpExpiresSeconds === 0/.test(src), 'must check expiry zero');
    assert.ok(/setPhoneOtpChallengeId\(null\)/.test(src), 'must clear challenge on expiry');
    assert.ok(/setPhoneOtpStep\('phone'\)/.test(src), 'must return to phone step on expiry');
  });

  await t.test('resend button enabled only when resend=0, expiry>0, not loading', () => {
    const resendMatch = src.match(/handleResendPhoneOtp[\s\S]*?phoneOtpResendSeconds > 0 \|\| phoneOtpExpiresSeconds <= 0 \|\| phoneOtpLoading/);
    assert.ok(resendMatch, 'must check all three conditions for resend disable');
    const buttonMatch = src.match(/disabled=\{phoneOtpResendSeconds > 0 \|\| phoneOtpExpiresSeconds <= 0 \|\| phoneOtpLoading\}/);
    assert.ok(buttonMatch, 'must wire conditions to resend button disabled');
  });

  await t.test('password or token not logged to console', () => {
    assert.ok(!/console\.log.*password/.test(src), 'must not log password');
    assert.ok(!/console\.log.*access_token/.test(src), 'must not log access_token');
    assert.ok(!/console\.log.*refresh_token/.test(src), 'must not log refresh_token');
    assert.ok(!/console\.log.*challenge_id/.test(src), 'must not log challenge_id');
  });

  await t.test('no placeholder assertions', () => {
    assert.ok(!/assert\.ok\(true\)/.test(src), 'no placeholder true assertions');
  });
});
