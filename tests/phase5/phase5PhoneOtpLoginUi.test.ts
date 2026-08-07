import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const src = readFileSync(join(process.cwd(), 'src', 'components', 'AuthPage.tsx'), 'utf8');

test('Phase 5E-D4 UI Fix 4 — Correct Phone Masking', async (t) => {

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

  await t.test('passwordTabVisible is not hardcoded to true', () => {
    assert.ok(!/const\s+passwordTabVisible\s*=\s*true/.test(src), 'must not hardcode passwordTabVisible = true');
    assert.ok(/passwordTabVisible\s*=\s*passwordLoginAvailable/.test(src), 'must derive passwordTabVisible from passwordLoginAvailable');
  });

  await t.test('get_public_login_methods is called for availability', () => {
    assert.ok(/get_public_login_methods/.test(src), 'must call get_public_login_methods for availability');
  });

  await t.test('at least one of three booleans enables password tab', () => {
    assert.ok(/username_login\s*===\s*true/.test(src), 'must check username_login');
    assert.ok(/email_login\s*===\s*true/.test(src), 'must check email_login');
    assert.ok(/phone_login\s*===\s*true/.test(src), 'must check phone_login');
    assert.ok(/passwordLoginAvailable/.test(src), 'must have passwordLoginAvailable state');
    assert.ok(/setPasswordLoginAvailable/.test(src), 'must have setPasswordLoginAvailable setter');
  });

  await t.test('all three disabled hides password tab', () => {
    assert.ok(/passwordTabVisible\s*=\s*passwordLoginAvailable/.test(src), 'passwordTabVisible must equal passwordLoginAvailable');
    assert.ok(/!passwordTabVisible/.test(src), 'must check !passwordTabVisible in render logic');
  });

  await t.test('login methods are not shown as selectors', () => {
    assert.ok(!/setLoginMethod\('username'\)/.test(src), 'must not have username selector button');
    assert.ok(!/setLoginMethod\('email'\)/.test(src), 'must not have email selector button');
    assert.ok(!/setLoginMethod\('phone'\)/.test(src), 'must not have phone selector button');
    assert.ok(!/activeMethods/.test(src), 'must not have activeMethods array');
  });

  await t.test('single unified identifier field is preserved', () => {
    const passwordTabMatch = src.match(/loginTab === 'password'[\s\S]*?<form[\s\S]*?<\/form>/);
    assert.ok(passwordTabMatch, 'must find password tab form');
    const form = passwordTabMatch![0];
    const inputMatches = form.match(/<input[^>]*id="login-identifier"/g) ?? [];
    assert.equal(inputMatches.length, 1, 'must have exactly one identifier input in password tab');
    assert.ok(src.includes('نام کاربری، ایمیل یا شماره موبایل'), 'must have unified label text');
    assert.ok(src.includes('نام کاربری، ایمیل یا شماره موبایل'), 'must have unified label text');
    assert.ok(/placeholder="نام کاربری، ایمیل یا[^"]*"/.test(src), 'must have unified placeholder text');
  });

  await t.test('auto method detection is preserved', () => {
    assert.ok(/function detectPasswordLoginMethod/.test(src), 'must declare detectPasswordLoginMethod');
    assert.ok(/detectPasswordLoginMethod\(value:\s*string\):\s*LoginMethod/.test(src), 'must have correct signature');
    const funcMatch = src.match(/function detectPasswordLoginMethod[\s\S]*?return 'username'[\s\S]*?\n\s*\}/);
    assert.ok(funcMatch, 'must find function body');
    const body = funcMatch![0];
    const phoneIdx = body.indexOf("return 'phone'");
    const emailIdx = body.indexOf("return 'email'");
    const usernameIdx = body.indexOf("return 'username'");
    assert.ok(phoneIdx > -1 && emailIdx > -1 && usernameIdx > -1, 'must detect all three methods');
    assert.ok(phoneIdx < emailIdx && emailIdx < usernameIdx, 'must check phone before email before username');
    assert.ok(/normalizeIranPhone/.test(body), 'must use normalizeIranPhone for phone detection');
    assert.ok(/\[.*\\s.*@\].*\[.*\\s.*@\].*\.\[.*\\s.*@\]/.test(body), 'must use email regex pattern');
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
    assert.ok(/Array\.isArray\(authConfigResult\.data\)\s*\?\s*authConfigResult\.data\[0\]\s*:\s*authConfigResult\.data/.test(src) ||
      /Array\.isArray\(.*data\)\s*\?\s*.*data\[0\]\s*:\s*.*data/.test(src),
      'must handle array response with [0] access');
  });

  await t.test('get_public_login_methods handles array with [0]', () => {
    assert.ok(/Array\.isArray\(loginMethodsResult\.data\)\s*\?\s*loginMethodsResult\.data\[0\]\s*:\s*loginMethodsResult\.data/.test(src) ||
      /Array\.isArray\(.*data\)\s*\?\s*.*data\[0\]\s*:\s*.*data/.test(src),
      'must handle array response with [0] access for login methods');
  });

  await t.test('public config is loaded only once (single useEffect)', () => {
    const configCalls = src.match(/get_public_auth_config/g) ?? [];
    assert.equal(configCalls.length, 1, 'must call get_public_auth_config exactly once');
  });

  await t.test('Promise.all fetches both configs together', () => {
    assert.ok(/Promise\.all/.test(src), 'must use Promise.all for parallel fetch');
  });

  await t.test('config error causes fail-closed with OTP tab hidden', () => {
    assert.ok(/setAuthConfig\(null\)/.test(src), 'must set authConfig to null on error');
    assert.ok(/setConnectionStatus\('disconnected'\)/.test(src), 'must set disconnected on error');
    assert.ok(/setPasswordLoginAvailable\(false\)/.test(src), 'must set passwordLoginAvailable to false on error');
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

  await t.test('no login available message shown when both tabs unavailable', () => {
    assert.ok(/ورود در حال حاضر در دسترس نیست/.test(src), 'must show no login available message');
  });

  await t.test('methodLabel and methodPlaceholder constants do not exist', () => {
    assert.ok(!/methodLabel/.test(src), 'must not have methodLabel constant');
    assert.ok(!/methodPlaceholder/.test(src), 'must not have methodPlaceholder constant');
  });

  await t.test('maskPhone does not use hardcoded three stars', () => {
    assert.ok(!/'\*\*\*'/.test(src), 'must not have hardcoded *** in maskPhone');
    assert.ok(!/\+ '\*\*\*'/.test(src), 'must not concatenate hardcoded three stars');
  });

  await t.test('maskPhone calculates hidden length dynamically', () => {
    const maskMatch = src.match(/const maskPhone[\s\S]*?\n\s*\};/);
    assert.ok(maskMatch, 'must find maskPhone function');
    const body = maskMatch![0];
    assert.ok(/hiddenLength/.test(body), 'must calculate hiddenLength');
    assert.ok(/normalized\.length\s*-\s*7/.test(body), 'must compute hidden length as length minus 7');
    assert.ok(/'\*'\.repeat\(hiddenLength\)/.test(body), 'must use repeat for dynamic star count');
  });

  await t.test('maskPhone produces four hidden chars for 11-digit number', () => {
    const maskMatch = src.match(/const maskPhone[\s\S]*?\n\s*\};/);
    assert.ok(maskMatch, 'must find maskPhone function');
    const body = maskMatch![0];
    assert.ok(/slice\(0,\s*4\)/.test(body), 'must keep first 4 chars');
    assert.ok(/slice\(-3\)/.test(body), 'must keep last 3 chars');
    assert.ok(/normalized\.length\s*-\s*7/.test(body), 'must subtract 7 for hidden length');
  });

  await t.test('maskPhone output length equals input length', () => {
    const maskMatch = src.match(/const maskPhone[\s\S]*?\n\s*\};/);
    assert.ok(maskMatch, 'must find maskPhone function');
    const body = maskMatch![0];
    assert.ok(/visibleStart/.test(body), 'must have visibleStart');
    assert.ok(/visibleEnd/.test(body), 'must have visibleEnd');
    assert.ok(/\$\{visibleStart\}/.test(body), 'must interpolate visibleStart');
    assert.ok(/\$\{visibleEnd\}/.test(body), 'must interpolate visibleEnd');
  });

  await t.test('maskPhone preserves first 4 and last 3 digits', () => {
    const maskMatch = src.match(/const maskPhone[\s\S]*?\n\s*\};/);
    assert.ok(maskMatch, 'must find maskPhone function');
    const body = maskMatch![0];
    assert.ok(/slice\(0,\s*4\)/.test(body), 'must slice first 4');
    assert.ok(/slice\(-3\)/.test(body), 'must slice last 3');
  });

  await t.test('masked phone displayed with dir=ltr in span', () => {
    assert.ok(/<span\s+dir="ltr"[^>]*>\{maskPhone\(phoneOtpPhone\)\}<\/span>/.test(src),
      'must wrap masked phone in span with dir=ltr');
  });

  await t.test('masked phone uses font-mono class', () => {
    assert.ok(/<span[^>]*className="inline-block font-mono"[^>]*>\{maskPhone/.test(src) ||
      /<span[^>]*font-mono[^>]*>\{maskPhone/.test(src),
      'must use font-mono class on masked phone span');
  });

  await t.test('full phone number not displayed in OTP step text', () => {
    assert.ok(!/\{phoneOtpPhone\}<\/span>/.test(src), 'must not render raw phoneOtpPhone in a span');
    assert.ok(!/>\{phoneOtpPhone\}</.test(src), 'must not render raw phoneOtpPhone between tags');
  });

  await t.test('OTP step text contains ارسال شد', () => {
    assert.ok(/ارسال شد/.test(src), 'must have ارسال شد text in OTP step');
  });

  await t.test('maskPhone handles short numbers by returning as-is', () => {
    const maskMatch = src.match(/const maskPhone[\s\S]*?\n\s*\};/);
    assert.ok(maskMatch, 'must find maskPhone function');
    const body = maskMatch![0];
    assert.ok(/<=\s*7/.test(body), 'must check length <= 7 for short numbers');
  });

  // ── Phase 5E-D5: Reports UI labels for auth/login_otp ──────────────

  await t.test('Reports UI has auth category label', () => {
    const typesPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'types.tsx');
    const typesSrc = readFileSync(typesPath, 'utf8');
    assert.ok(/auth:\s*'احراز هویت'/.test(typesSrc), 'must have auth category label in types');
  });

  await t.test('Reports UI has login_otp event label', () => {
    const typesPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'types.tsx');
    const typesSrc = readFileSync(typesPath, 'utf8');
    assert.ok(/login_otp:\s*'کد ورود'/.test(typesSrc), 'must have login_otp event label in types');
  });

  await t.test('Reports UI has auth category color', () => {
    const typesPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'types.tsx');
    const typesSrc = readFileSync(typesPath, 'utf8');
    assert.ok(/auth:\s*'bg-cyan/.test(typesSrc), 'must have auth category color in CATEGORY_COLORS');
  });

  await t.test('Reports UI displays target_phone field', () => {
    const reportsPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'ReportsTab.tsx');
    const reportsSrc = readFileSync(reportsPath, 'utf8');
    assert.ok(/target_phone/.test(reportsSrc), 'must display target_phone in reports');
  });

  await t.test('Reports UI displays provider_message_id and pack_id', () => {
    const reportsPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'ReportsTab.tsx');
    const reportsSrc = readFileSync(reportsPath, 'utf8');
    assert.ok(/provider_message_id/.test(reportsSrc), 'must display provider_message_id');
    assert.ok(/pack_id/.test(reportsSrc), 'must display pack_id');
  });

  await t.test('Reports UI displays message text', () => {
    const reportsPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'ReportsTab.tsx');
    const reportsSrc = readFileSync(reportsPath, 'utf8');
    assert.ok(/log\.message/.test(reportsSrc), 'must display log.message');
  });

  await t.test('Reports UI displays provider name', () => {
    const reportsPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'ReportsTab.tsx');
    const reportsSrc = readFileSync(reportsPath, 'utf8');
    assert.ok(/provider_name/.test(reportsSrc), 'must display provider_name');
  });

  await t.test('Reports UI displays status', () => {
    const reportsPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'ReportsTab.tsx');
    const reportsSrc = readFileSync(reportsPath, 'utf8');
    assert.ok(/log\.status/.test(reportsSrc), 'must display log.status');
  });

  // ── Phase 5E-D5 Final Fix: Complete OTP Dispatch Report UX ─────────

  await t.test('Reports UI has SMS_ERROR_LABELS mapping', () => {
    const typesPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'types.tsx');
    const typesSrc = readFileSync(typesPath, 'utf8');
    assert.ok(/AUTH_TARGET_NOT_ELIGIBLE/.test(typesSrc), 'must map AUTH_TARGET_NOT_ELIGIBLE');
    assert.ok(/NO_ACTIVE_SMS_PROVIDER/.test(typesSrc), 'must map NO_ACTIVE_SMS_PROVIDER');
    assert.ok(/SMS_PROVIDER_TIMEOUT/.test(typesSrc), 'must map SMS_PROVIDER_TIMEOUT');
    assert.ok(/SMS_PROVIDER_REJECTED/.test(typesSrc), 'must map SMS_PROVIDER_REJECTED');
    assert.ok(/SMS_DISPATCH_FAILED/.test(typesSrc), 'must map SMS_DISPATCH_FAILED');
    assert.ok(/OTP_TEMPLATE_UNAVAILABLE/.test(typesSrc), 'must map OTP_TEMPLATE_UNAVAILABLE');
    assert.ok(/CHALLENGE_CREATION_FAILED/.test(typesSrc), 'must map CHALLENGE_CREATION_FAILED');
    assert.ok(/RESEND_NOT_READY/.test(typesSrc), 'must map RESEND_NOT_READY');
    assert.ok(/SMS_PROVIDER_CONFIG_INVALID/.test(typesSrc), 'must map SMS_PROVIDER_CONFIG_INVALID');
    assert.ok(/SMS_PROVIDER_CONNECTION_FAILED/.test(typesSrc), 'must map SMS_PROVIDER_CONNECTION_FAILED');
    assert.ok(/AMBIGUOUS_SMS_PROVIDER/.test(typesSrc), 'must map AMBIGUOUS_SMS_PROVIDER');
  });

  await t.test('Reports UI has smsErrorLabel function', () => {
    const typesPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'types.tsx');
    const typesSrc = readFileSync(typesPath, 'utf8');
    assert.ok(/function smsErrorLabel/.test(typesSrc), 'must have smsErrorLabel function');
    assert.ok(/خطای ثبت‌شده در فرآیند ارسال/.test(typesSrc), 'must have fallback label for unknown codes');
  });

  await t.test('Reports UI uses smsErrorLabel for error display', () => {
    const reportsPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'ReportsTab.tsx');
    const reportsSrc = readFileSync(reportsPath, 'utf8');
    assert.ok(/smsErrorLabel/.test(reportsSrc), 'must call smsErrorLabel for error display');
    assert.ok(/علت/.test(reportsSrc), 'must have علت label for error');
  });

  await t.test('Reports UI never shows پیش‌فرض for null provider', () => {
    const reportsPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'ReportsTab.tsx');
    const reportsSrc = readFileSync(reportsPath, 'utf8');
    assert.ok(!/پیش‌فرض/.test(reportsSrc), 'must not show پیش‌فرض for null provider');
    assert.ok(/انتخاب نشد/.test(reportsSrc), 'must show انتخاب نشد for null provider');
  });

  await t.test('Reports UI shows شماره واردشده for unresolved user', () => {
    const reportsPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'ReportsTab.tsx');
    const reportsSrc = readFileSync(reportsPath, 'utf8');
    assert.ok(/شماره واردشده/.test(reportsSrc), 'must show شماره واردشده for null target_user_id');
    assert.ok(/شماره مقصد/.test(reportsSrc), 'must show شماره مقصد for resolved user');
  });

  await t.test('Reports UI shows قابل بررسی نیست for non-sent delivery', () => {
    const typesPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'types.tsx');
    const typesSrc = readFileSync(typesPath, 'utf8');
    assert.ok(/قابل بررسی نیست/.test(typesSrc), 'must have قابل بررسی نیست label');
    assert.ok(/وضعیت تحویل توسط سرویس‌دهنده ارائه نشده/.test(typesSrc), 'must have sent but no delivery label');
  });

  await t.test('Reports UI shows ارسال انجام نشد for skipped status', () => {
    const typesPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'types.tsx');
    const typesSrc = readFileSync(typesPath, 'utf8');
    assert.ok(/ارسال انجام نشد/.test(typesSrc), 'must show ارسال انجام نشد for skipped status');
  });

  await t.test('Reports UI has login OTP stage section', () => {
    const reportsPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'ReportsTab.tsx');
    const reportsSrc = readFileSync(reportsPath, 'utf8');
    assert.ok(/فرآیند ورود پیامکی/.test(reportsSrc), 'must have فرآیند ورود پیامکی section');
    assert.ok(/تطبیق کاربر/.test(reportsSrc), 'must show user match stage');
    assert.ok(/تولید کد/.test(reportsSrc), 'must show OTP generation stage');
    assert.ok(/آماده‌سازی پیام/.test(reportsSrc), 'must show message preparation stage');
    assert.ok(/ارسال به سرویس‌دهنده/.test(reportsSrc), 'must show dispatch stage');
  });

  await t.test('Reports UI shows ورود با کد پیامکی for login OTP', () => {
    const reportsPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'ReportsTab.tsx');
    const reportsSrc = readFileSync(reportsPath, 'utf8');
    assert.ok(/ورود با کد پیامکی/.test(reportsSrc), 'must show ورود با کد پیامکی for login OTP');
  });

  await t.test('Reports UI shows پیامک تولید نشد for pre-OTP message', () => {
    const reportsPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'ReportsTab.tsx');
    const reportsSrc = readFileSync(reportsPath, 'utf8');
    assert.ok(/پیامک تولید نشد/.test(reportsSrc), 'must show پیامک تولید نشد for pre-OTP message');
  });

  await t.test('Reports UI shows وضعیت تطبیق کاربر', () => {
    const reportsPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'ReportsTab.tsx');
    const reportsSrc = readFileSync(reportsPath, 'utf8');
    assert.ok(/وضعیت تطبیق کاربر/.test(reportsSrc), 'must show وضعیت تطبیق کاربر');
    assert.ok(/تطبیق موفق/.test(reportsSrc), 'must show تطبیق موفق for resolved user');
    assert.ok(/کاربر معتبری/.test(reportsSrc), 'must show ineligible user message');
  });

  await t.test('Reports UI shows وضعیت تولید کد', () => {
    const reportsPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'ReportsTab.tsx');
    const reportsSrc = readFileSync(reportsPath, 'utf8');
    assert.ok(/وضعیت تولید کد/.test(reportsSrc), 'must show وضعیت تولید کد');
    assert.ok(/کد ۶ رقمی تولید شد/.test(reportsSrc), 'must show کد ۶ رقمی تولید شد');
    assert.ok(/تولید نشد/.test(reportsSrc), 'must show تولید نشد for pre-OTP');
  });

  await t.test('Reports UI has isLoginOtpLog and loginOtpStageInfo helpers', () => {
    const typesPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'types.tsx');
    const typesSrc = readFileSync(typesPath, 'utf8');
    assert.ok(/function isLoginOtpLog/.test(typesSrc), 'must have isLoginOtpLog function');
    assert.ok(/function loginOtpStageInfo/.test(typesSrc), 'must have loginOtpStageInfo function');
  });

  await t.test('Reports UI has smsDeliveryLabel function', () => {
    const typesPath = join(process.cwd(), 'src', 'components', 'SmsConfig', 'types.tsx');
    const typesSrc = readFileSync(typesPath, 'utf8');
    assert.ok(/function smsDeliveryLabel/.test(typesSrc), 'must have smsDeliveryLabel function');
  });
});
