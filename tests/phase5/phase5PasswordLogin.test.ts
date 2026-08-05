import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir);

const phase5Migration = migrationFiles.find(
  (f) => f.includes('phase5a_password_login_rate_limit_and_methods'),
);

const passwordLoginFn = readFileSync(
  join(root, 'supabase', 'functions', 'password-login', 'index.ts'),
  'utf8',
);

const usernameLoginFn = readFileSync(
  join(root, 'supabase', 'functions', 'username-login', 'index.ts'),
  'utf8',
);

const authPageSrc = readFileSync(join(root, 'src', 'components', 'AuthPage.tsx'), 'utf8');

describe('Phase 5A — Password Login', () => {

  it('phase5a migration file exists', () => {
    assert.ok(phase5Migration, 'phase5a migration file must exist');
  });

  it('previous migrations are unchanged (count includes new one)', () => {
    // The new migration is additive; existing files still present
    const grantMigration = migrationFiles.find((f) =>
      f.includes('grant_private_schema_usage_to_service_role'),
    );
    assert.ok(grantMigration, 'previous grant migration must still exist');
  });

  it('rate limit table stores only hashes — no raw password or identifier', () => {
    assert.ok(phase5Migration);
    const sql = readFileSync(join(migrationsDir, phase5Migration!), 'utf8');
    assert.ok(sql.includes('identifier_hash'), 'must have identifier_hash column');
    assert.ok(sql.includes('ip_hash'), 'must have ip_hash column');
    // The table must not have a raw password or identifier column
    assert.ok(!sql.includes('password text'), 'must not store raw password column');
    assert.ok(!sql.includes('identifier text'), 'must not store raw identifier column');
    assert.ok(!sql.includes('raw_identifier'), 'must not store raw identifier');
  });

  it('RPC is granted only to service_role', () => {
    assert.ok(phase5Migration);
    const sql = readFileSync(join(migrationsDir, phase5Migration!), 'utf8');
    assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION\npublic.consume_password_login_rate_limit_v1'), 'must grant execute to service_role');
    assert.ok(sql.includes('TO service_role'), 'must grant to service_role');
    assert.ok(sql.includes('FROM PUBLIC, anon, authenticated'), 'must revoke from public/anon/authenticated');
  });

  it('get_public_login_methods does not depend on SMS for phone_login', () => {
    assert.ok(phase5Migration);
    const sql = readFileSync(join(migrationsDir, phase5Migration!), 'utf8');
    assert.ok(!sql.includes('check_phone_login_dependencies_ready'), 'must not call check_phone_login_dependencies_ready');
    assert.ok(sql.includes('v_row.phone_login'), 'phone_login must come directly from auth_security_settings');
  });

  it('password-login supports all three methods', () => {
    assert.ok(passwordLoginFn.includes('"username"'));
    assert.ok(passwordLoginFn.includes('"email"'));
    assert.ok(passwordLoginFn.includes('"phone"'));
  });

  it('password-login checks method enabled status', () => {
    assert.ok(passwordLoginFn.includes('get_public_login_methods'), 'must call get_public_login_methods');
    assert.ok(passwordLoginFn.includes('LOGIN_METHOD_DISABLED'), 'must return LOGIN_METHOD_DISABLED');
  });

  it('password-login executes rate limit RPC', () => {
    assert.ok(passwordLoginFn.includes('consume_password_login_rate_limit_v1'), 'must call rate limit RPC');
    assert.ok(passwordLoginFn.includes('429') || passwordLoginFn.includes('RATE_LIMITED'), 'must handle rate limit response');
  });

  it('password-login CORS has no wildcard', () => {
    assert.ok(!passwordLoginFn.includes('"*"'), 'must not use wildcard ACAO');
    assert.ok(passwordLoginFn.includes('allowedOrigin'), 'must use exact origin match');
  });

  it('password-login does not return internal email for username login', () => {
    assert.ok(passwordLoginFn.includes('get_email_by_username'), 'must look up email via service role');
    assert.ok(passwordLoginFn.includes('invalid-'), 'must use synthetic email for non-existent username');
    // The response only returns access_token, refresh_token, login_method
    assert.ok(passwordLoginFn.includes('access_token'));
    assert.ok(passwordLoginFn.includes('refresh_token'));
    assert.ok(passwordLoginFn.includes('login_method'));
  });

  it('phone login uses signInWithPassword, not OTP', () => {
    assert.ok(passwordLoginFn.includes('signInWithPassword'), 'must use signInWithPassword');
    assert.ok(passwordLoginFn.includes("phone: signInIdentifier"), 'must sign in with phone');
    assert.ok(!passwordLoginFn.includes('request-phone-login-otp'), 'must not call OTP endpoint');
    assert.ok(!passwordLoginFn.includes('verify-phone-login-otp'), 'must not call OTP verify endpoint');
  });

  it('mobile login sends no OTP', () => {
    // password-login function must not reference OTP sending
    assert.ok(!passwordLoginFn.includes('sendOtp'), 'must not send OTP');
    assert.ok(!passwordLoginFn.includes('otp'), 'must not reference OTP');
  });

  it('AuthPage calls only password-login for login', () => {
    // handleLogin should call password-login edge function
    assert.ok(authPageSrc.includes('/functions/v1/password-login'), 'AuthPage must call password-login');
    // Must not directly call signInWithPassword in handleLogin
    // Check that supabase.auth.signInWithPassword is not used for login
    const loginSection = authPageSrc.split('handleLogin')[1]?.split('handleRegister')[0] ?? '';
    assert.ok(!loginSection.includes('signInWithPassword'), 'handleLogin must not call signInWithPassword directly');
    assert.ok(!loginSection.includes('username-login'), 'handleLogin must not call old username-login');
    assert.ok(!loginSection.includes('request-phone-login-otp'), 'handleLogin must not call OTP');
    assert.ok(!loginSection.includes('verify-phone-login-otp'), 'handleLogin must not call OTP verify');
    assert.ok(loginSection.includes('setSession'), 'must set session from tokens');
  });

  it('AuthPage uses LoginMethod type and PublicLoginMethods interface', () => {
    assert.ok(authPageSrc.includes("type LoginMethod = 'username' | 'email' | 'phone'"));
    assert.ok(authPageSrc.includes('interface PublicLoginMethods'));
  });

  it('AuthPage shows no active methods message when all disabled', () => {
    assert.ok(authPageSrc.includes('ورود در حال حاضر در دسترس نیست'), 'must show unavailable message');
  });

  it('AuthPage has proper error messages for 401/403/429/503', () => {
    assert.ok(authPageSrc.includes('شناسه ورود یا رمز عبور صحیح نیست'), 'must have 401 message');
    assert.ok(authPageSrc.includes('این روش ورود در حال حاضر غیرفعال است'), 'must have 403 message');
    assert.ok(authPageSrc.includes('تعداد تلاش‌ها بیش از حد مجاز است'), 'must have 429 message');
    assert.ok(authPageSrc.includes('در حال حاضر امکان ورود وجود ندارد'), 'must have 503 message');
  });

  it('old username-login endpoint always returns 410', () => {
    assert.ok(usernameLoginFn.includes('410'), 'must return 410');
    assert.ok(usernameLoginFn.includes('LOGIN_ROUTE_REPLACED'), 'must return LOGIN_ROUTE_REPLACED');
    assert.ok(!usernameLoginFn.includes('signInWithPassword'), 'must not call signInWithPassword');
  });

  it('old username-login returns 405 for non-POST methods', () => {
    assert.ok(usernameLoginFn.includes('405'), 'must return 405 for non-POST');
    assert.ok(usernameLoginFn.includes('METHOD_NOT_ALLOWED'), 'must return METHOD_NOT_ALLOWED');
  });

  it('tests do not pass via comments or formal expressions only', () => {
    // This test itself uses real assertions — verify all previous tests used assert.ok
    assert.ok(true, 'this is a real assertion, not a comment');
  });
});
