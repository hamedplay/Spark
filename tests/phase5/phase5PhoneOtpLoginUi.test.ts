import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const src = readFileSync(join(process.cwd(), 'src', 'components', 'AuthPage.tsx'), 'utf8');

test('Phase 5E-D4 UI Fix 2 — Unified Password Identifier and Visible OTP Tab', async (t) => {

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

  await t.test('main tab text is exactly ورود با رمز عبور and ورود با کد پیامکی', () => {
    assert.ok(src.includes('ورود با رمز عبور'), 'must have password tab text');
    assert.ok(src.includes('ورود با کد پیامکی'), 'must have OTP tab text');
  });

  await t.test('no username, email, or phone selectors inside the form', () => {
    assert.ok(!/setLoginMethod\('username'\)/.test(src), 'must not have username selector button');
    assert.ok(!/setLoginMethod\('email'\)/.test(src), 'must not have email selector button');
    assert.ok(!/setLoginMethod\('phone'\)/.test(src), 'must not have phone selector button');
    assert.ok(!/activeMethods/.test(src), 'must not have activeMethods array');
  });

  await t.test('loginMethod state and setLoginMethod do not exist', () => {
    assert.ok(!/const \[loginMethod,\s*setLoginMethod\]/.test(src), 'must not have loginMethod state');
    assert.ok(!/setLoginMethod/.test(src), 'must not reference setLoginMethod');
  });

  await t.test('only one password identifier input exists', () => {
    const passwordTabMatch = src.match(/loginTab === 'password'[\s\S]*?<form[\s\S]*?<\/form>/);
    assert.ok(passwordTabMatch, 'must find password tab form');
    const form = passwordTabMatch![0];
    const inputMatches = form.match(/<input[^>]*id="login-identifier"/g) ?? [];
    assert.equal(inputMatches.length, 1, 'must have exactly one identifier input in password tab');
  });

  await t.test('unified label includes username, email, and phone', () => {
    assert.ok(src.includes('نام کاربری، ایمیل یا شماره موبایل'), 'must have unified label text');
  });

  await t.test('unified placeholder includes username, email, and phone', () => {
    assert.ok(src.includes('نام کاربری، ایمیل یا 09123456789'), 'must have unified placeholder text');
  });

  await t.test('identifier input has correct attributes', () => {
    const inputMatch = src.match(/<input[\s\S]*?id="login-identifier"[\s\S]*?\/>/);
    assert.ok(inputMatch, 'must find identifier input');
    const input = inputMatch![0];
    assert.ok(/type="text"/.test(input), 'must be type=text');
    assert.ok(/dir="ltr"/.test(input), 'must have dir=ltr');
    assert.ok(/autoComplete="username"/.test(input), 'must have autoComplete=username');
    assert.ok(/spellCheck=\{false\}/.test(input), 'must have spellCheck=false');
    assert.ok(/autoCapitalize="off"/.test(input), 'must have autoCapitalize=off');
  });

  await t.test('detectPasswordLoginMethod function exists', () => {
    assert.ok(/function detectPasswordLoginMethod/.test(src), 'must declare detectPasswordLoginMethod');
    assert.ok(/detectPasswordLoginMethod\(value:\s*string\):\s*LoginMethod/.test(src), 'must have correct signature');
  });

  await t.test('phone is detected before email and username', () => {
    const funcMatch = src.match(/function detectPasswordLoginMethod[\s\S]*?return 'username'[\s\S]*?\n\s*\}/);
    assert.ok(funcMatch, 'must find function body');
    const body = funcMatch![0];
    const phoneIdx = body.indexOf("return 'phone'");
    const emailIdx = body.indexOf("return 'email'");
    const usernameIdx = body.indexOf("return 'username'");
    assert.ok(phoneIdx > -1, 'must detect phone');
    assert.ok(emailIdx > -1, 'must detect email');
    assert.ok(usernameIdx > -1, 'must detect username');
    assert.ok(phoneIdx < emailIdx, 'phone must be checked before email');
    assert.ok(emailIdx < usernameIdx, 'email must be checked before username');
  });

  await t.test('phone detection uses normalizeIranPhone', () => {
    const funcMatch = src.match(/function detectPasswordLoginMethod[\s\S]*?return 'username'[\s\S]*?\n\s*\}/);
    assert.ok(funcMatch, 'must find function body');
    assert.ok(/normalizeIranPhone/.test(funcMatch![0]), 'must use normalizeIranPhone for phone detection');
  });

  await t.test('email is detected with regex', () => {
    const funcMatch = src.match(/function detectPasswordLoginMethod[\s\S]*?return 'username'[\s\S]*?\n\s*\}/);
    assert.ok(funcMatch, 'must find function body');
    assert.ok(/\[.*\\s.*@\].*\[.*\\s.*@\].*\.\[.*\\s.*@\]/.test(funcMatch![0]),
      'must use email regex pattern');
  });

  await t.test('non-phone non-email value defaults to username', () => {
    const funcMatch = src.match(/function detectPasswordLoginMethod[\s\S]*?return 'username'[\s\S]*?\n\s*\}/);
    assert.ok(funcMatch, 'must find function body');
    assert.ok(/return 'username'/.test(funcMatch![0]), 'must return username as default');
  });

  await t.test('detected method is sent to password-login endpoint', () => {
    const loginMatch = src.match(/password-login[\s\S]*?body:\s*JSON\.stringify\(\s*\{([^}]+)\}/);
    assert.ok(loginMatch, 'must find password-login body');
    const body = loginMatch![1];
    assert.ok(/detectedMethod/.test(body), 'must use detectedMethod in body');
    assert.ok(/trimmedIdentifier/.test(body), 'must use trimmedIdentifier in body');
    assert.ok(!/loginMethod/.test(body), 'must not use loginMethod in body');
  });

  await t.test('get_public_auth_config handles array with [0]', () => {
    assert.ok(/Array\.isArray\(data\)\s*\?\s*data\[0\]\s*:\s*data/.test(src),
      'must handle array response with [0] access');
  });

  await t.test('public config is loaded only once (single useEffect)', () => {
    const configCalls = src.match(/get_public_auth_config/g) ?? [];
    assert.equal(configCalls.length, 1, 'must call get_public_auth_config exactly once');
  });

  await t.test('config error causes fail-closed with OTP tab hidden', () => {
    assert.ok(/if \(error \|\| !row \|\| typeof row !== 'object'\)/.test(src),
      'must check error, null row, and non-object row');
    assert.ok(/setAuthConfig\(null\)/.test(src), 'must set authConfig to null on error');
    assert.ok(/setConnectionStatus\('disconnected'\)/.test(src), 'must set disconnected on error');
  });

  await t.test('phone_login_canonical_enabled=true makes OTP tab visible', () => {
    assert.ok(/phone_login_canonical_enabled/.test(src), 'must check phone_login_canonical_enabled');
    assert.ok(/phoneOtpTabVisible/.test(src), 'must compute phoneOtpTabVisible');
  });

  await t.test('phone_login_ready=true makes OTP tab enabled', () => {
    assert.ok(/phone_login_ready/.test(src), 'must check phone_login_ready');
    assert.ok(/phoneOtpTabDisabled/.test(src), 'must compute disabled state');
    assert.ok(/disabled=\{phoneOtpTabDisabled\}/.test(src), 'must apply disabled to tab button');
  });

  await t.test('OTP endpoints are only V2', () => {
    assert.ok(/request-phone-login-otp-v2/.test(src), 'must call request-phone-login-otp-v2');
    assert.ok(/verify-phone-login-otp-v2/.test(src), 'must call verify-phone-login-otp-v2');
    assert.ok(!/request-phone-login-otp['"]/.test(src), 'must not use legacy request endpoint');
    assert.ok(!/verify-phone-login-otp['"]/.test(src), 'must not use legacy verify endpoint');
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

  await t.test('no direct Supabase login added', () => {
    assert.ok(!/supabase\.auth\.signInWithPassword/.test(src), 'must not add direct auth signInWithPassword');
    assert.ok(!/supabase\.auth\.signInWithOtp/.test(src), 'must not add direct auth signInWithOtp');
  });

  await t.test('legacy endpoints are not used', () => {
    assert.ok(!/signInWithPassword/.test(src), 'must not use signInWithPassword');
    assert.ok(!/signInWithOtp/.test(src), 'must not use signInWithOtp');
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
    assert.ok(/400.*شماره موبایل نامعتبر/.test(src) || /res\.status === 400[\s\S]*?شماره موبایل نامعتبر/.test(src),
      'must map 400 to invalid phone');
    assert.ok(/429[\s\S]*?retry_after_seconds/.test(src), 'must map 429 with retry_after');
    assert.ok(/503[\s\S]*?ورود پیامکی در دسترس نیست/.test(src), 'must map 503 to unavailable');
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

  await t.test('isValidUuid helper exists and validates UUID format', () => {
    assert.ok(/function isValidUuid\(value: unknown\): value is string/.test(src), 'must declare isValidUuid with type guard');
    assert.ok(/UUID_RE/.test(src), 'must define UUID regex');
    assert.ok(/isValidUuid\(result\.challenge_id\)/.test(src), 'must validate challenge_id with isValidUuid');
  });

  await t.test('isValidOtpTimer helper exists and validates integer range 30-300', () => {
    assert.ok(/function isValidOtpTimer\(value: unknown\): value is number/.test(src), 'must declare isValidOtpTimer with type guard');
    assert.ok(/Number\.isInteger/.test(src), 'must check integer');
    assert.ok(/>= 30/.test(src), 'must check min 30');
    assert.ok(/<= 300/.test(src), 'must check max 300');
    assert.ok(/isValidOtpTimer\(result\.retry_after_seconds\)/.test(src), 'must validate retry_after_seconds');
    assert.ok(/isValidOtpTimer\(result\.expires_in_seconds\)/.test(src), 'must validate expires_in_seconds');
  });

  await t.test('auto-select only usable tab when password tab unavailable', () => {
    assert.ok(/!passwordTabVisible && phoneOtpTabVisible && !phoneOtpTabDisabled/.test(src),
      'must auto-select phone_otp when password unavailable and OTP ready');
    assert.ok(/loginTab !== 'phone_otp'/.test(src), 'must avoid redundant tab set');
  });

  await t.test('auto-select password tab when OTP hidden or disabled', () => {
    assert.ok(/\(!phoneOtpTabVisible \|\| phoneOtpTabDisabled\) && passwordTabVisible/.test(src),
      'must auto-select password when OTP hidden or disabled');
    assert.ok(/loginTab !== 'password'/.test(src), 'must avoid redundant tab set');
  });

  await t.test('get_public_login_methods is not called', () => {
    assert.ok(!/get_public_login_methods/.test(src), 'must not call get_public_login_methods');
  });

  await t.test('methodLabel and methodPlaceholder constants do not exist', () => {
    assert.ok(!/methodLabel/.test(src), 'must not have methodLabel constant');
    assert.ok(!/methodPlaceholder/.test(src), 'must not have methodPlaceholder constant');
  });
});
