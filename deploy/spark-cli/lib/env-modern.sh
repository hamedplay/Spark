# Modern Supabase environment/auth compatibility layer.
# Loaded after the base install modules to keep the self-hosted runtime aligned
# with the current Supabase environment contract.

# Preserve the base implementations that we extend below.
eval "$(declare -f install_step_6 | sed '1s/install_step_6/install_step_6_base/')"
eval "$(declare -f install_step_7 | sed '1s/install_step_7/install_step_7_base/')"
eval "$(declare -f patch_compose | sed '1s/patch_compose/patch_compose_base/')"

env_validation_error() {
  local message="$1"
  printf 'ENV VALIDATION: %s\n' "$message" >>"${CURRENT_LOG:-/dev/null}"
  return 1
}

env_expect_exact() {
  local file="$1" key="$2" expected="$3" actual
  actual="$(env_get "$file" "$key")"
  [[ "$actual" == "$expected" ]] || env_validation_error "$key expected [$expected], got [$actual]"
}

env_require_real() {
  local file="$1" key="$2" value
  value="$(env_get "$file" "$key")"
  [[ -n "$value" ]] || { env_validation_error "$key is empty"; return 1; }
  if is_placeholder_value "$value"; then
    env_validation_error "$key still contains a placeholder"
    return 1
  fi
}

modern_auth_keys_valid() {
  local file="${SUPABASE_ROOT}/.env"
  JWT_SECRET_VALUE="$(env_get "$file" JWT_SECRET)" \
  SUPABASE_PUBLISHABLE_KEY_VALUE="$(env_get "$file" SUPABASE_PUBLISHABLE_KEY)" \
  SUPABASE_SECRET_KEY_VALUE="$(env_get "$file" SUPABASE_SECRET_KEY)" \
  ANON_KEY_ASYMMETRIC_VALUE="$(env_get "$file" ANON_KEY_ASYMMETRIC)" \
  SERVICE_ROLE_KEY_ASYMMETRIC_VALUE="$(env_get "$file" SERVICE_ROLE_KEY_ASYMMETRIC)" \
  JWT_KEYS_VALUE="$(env_get "$file" JWT_KEYS)" \
  JWT_JWKS_VALUE="$(env_get "$file" JWT_JWKS)" \
  node <<'NODE'
const {
  JWT_SECRET_VALUE: secret,
  SUPABASE_PUBLISHABLE_KEY_VALUE: publishable,
  SUPABASE_SECRET_KEY_VALUE: service,
  ANON_KEY_ASYMMETRIC_VALUE: anonJwt,
  SERVICE_ROLE_KEY_ASYMMETRIC_VALUE: serviceJwt,
  JWT_KEYS_VALUE: rawKeys,
  JWT_JWKS_VALUE: rawJwks,
} = process.env;
if (!secret || !publishable || !service || !anonJwt || !serviceJwt || !rawKeys || !rawJwks) process.exit(1);
if (!publishable.startsWith('sb_publishable_') || !service.startsWith('sb_secret_')) process.exit(1);
try {
  const keys = JSON.parse(rawKeys);
  const jwks = JSON.parse(rawJwks);
  if (!Array.isArray(keys) || !jwks || !Array.isArray(jwks.keys)) process.exit(1);
  const expectedK = Buffer.from(secret).toString('base64url');
  const octPrivate = keys.find(k => k && k.kty === 'oct' && k.alg === 'HS256');
  const octPublic = jwks.keys.find(k => k && k.kty === 'oct' && k.alg === 'HS256');
  const ecPrivate = keys.find(k => k && k.kty === 'EC' && k.alg === 'ES256' && k.d);
  const ecPublic = jwks.keys.find(k => k && k.kty === 'EC' && k.alg === 'ES256' && !k.d);
  if (!octPrivate || !octPublic || octPrivate.k !== expectedK || octPublic.k !== expectedK) process.exit(1);
  if (!ecPrivate || !ecPublic || !ecPrivate.kid || ecPrivate.kid !== ecPublic.kid || ecPrivate.x !== ecPublic.x || ecPrivate.y !== ecPublic.y) process.exit(1);
} catch (_) { process.exit(1); }
NODE
}

generate_modern_auth_keys() {
  local file="${SUPABASE_ROOT}/.env" jwt_secret output key value
  jwt_secret="$(env_get "$file" JWT_SECRET)"
  [[ -n "$jwt_secret" ]] || { env_validation_error "JWT_SECRET is required before generating modern auth keys"; return 1; }

  output="$(JWT_SECRET_VALUE="$jwt_secret" node <<'NODE'
const crypto = require('crypto');
const jwtSecret = process.env.JWT_SECRET_VALUE;
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwkPrivate = privateKey.export({ format: 'jwk' });
const kid = crypto.randomUUID();
const octKey = { kty: 'oct', k: Buffer.from(jwtSecret).toString('base64url'), alg: 'HS256' };
const ecPrivate = { kty: 'EC', kid, use: 'sig', key_ops: ['sign','verify'], alg: 'ES256', ext: true, crv: jwkPrivate.crv, x: jwkPrivate.x, y: jwkPrivate.y, d: jwkPrivate.d };
const ecPublic = { kty: 'EC', kid, use: 'sig', key_ops: ['verify'], alg: 'ES256', ext: true, crv: jwkPrivate.crv, x: jwkPrivate.x, y: jwkPrivate.y };
const jwtKeys = { keys: [ecPrivate, octKey] };
const jwtJwks = { keys: [ecPublic, octKey] };
function signES256(payload) {
  const header = { alg: 'ES256', typ: 'JWT', kid };
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = h + '.' + p;
  const sig = crypto.sign('SHA256', Buffer.from(data), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return data + '.' + sig;
}
const iat = Math.floor(Date.now()/1000);
const exp = iat + 5*365*24*3600;
function opaque(prefix) {
  const random = crypto.randomBytes(17).toString('base64url').slice(0,22);
  const intermediate = prefix + random;
  const checksum = crypto.createHash('sha256').update('supabase-self-hosted|' + intermediate).digest('base64url').slice(0,8);
  return intermediate + '_' + checksum;
}
console.log('SUPABASE_PUBLISHABLE_KEY=' + opaque('sb_publishable_'));
console.log('SUPABASE_SECRET_KEY=' + opaque('sb_secret_'));
console.log('ANON_KEY_ASYMMETRIC=' + signES256({ role:'anon', iss:'supabase', iat, exp }));
console.log('SERVICE_ROLE_KEY_ASYMMETRIC=' + signES256({ role:'service_role', iss:'supabase', iat, exp }));
console.log('JWT_KEYS=' + JSON.stringify(jwtKeys.keys));
console.log('JWT_JWKS=' + JSON.stringify(jwtJwks));
NODE
)" || return 1

  while IFS='=' read -r key value; do
    case "$key" in
      SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY|ANON_KEY_ASYMMETRIC|SERVICE_ROLE_KEY_ASYMMETRIC|JWT_KEYS|JWT_JWKS)
        env_set "$file" "$key" "$value" ;;
    esac
  done <<<"$output"
  chmod 600 "$file"
}

ensure_modern_auth_keys() {
  modern_auth_keys_valid && return 0
  info "Generating coherent Supabase asymmetric/JWKS and opaque API keys using the official self-hosted format."
  generate_modern_auth_keys || return 1
  modern_auth_keys_valid || { env_validation_error "generated modern auth key set failed coherence validation"; return 1; }
}

complete_reference_env_defaults() {
  local file="${SUPABASE_ROOT}/.env"
  # Provider availability and public sign-up are separate GoTrue controls.
  # Keep email/password login enabled for existing users while public sign-up
  # remains disabled for this internal application.
  env_set "$file" COMPOSE_FILE "docker-compose.yml"
  env_set "$file" DASHBOARD_USERNAME "supabase"
  env_set "$file" JWT_EXPIRY "3600"
  env_set "$file" ENABLE_EMAIL_SIGNUP "true"
  env_set "$file" DISABLE_SIGNUP "true"
  env_set "$file" MAILER_URLPATHS_CONFIRMATION "/auth/v1/verify"
  env_set "$file" MAILER_URLPATHS_INVITE "/auth/v1/verify"
  env_set "$file" MAILER_URLPATHS_RECOVERY "/auth/v1/verify"
  env_set "$file" MAILER_URLPATHS_EMAIL_CHANGE "/auth/v1/verify"
  env_set "$file" ENABLE_EMAIL_AUTOCONFIRM "false"
  env_set "$file" ENABLE_ANONYMOUS_USERS "false"
  env_set "$file" ENABLE_PHONE_SIGNUP "true"
  env_set "$file" ENABLE_PHONE_AUTOCONFIRM "true"
  env_set "$file" DOCKER_SOCKET_LOCATION "/var/run/docker.sock"
  env_set "$file" GLOBAL_S3_BUCKET "spark-storage"
  env_set "$file" REGION "local"
  env_set "$file" MINIO_ROOT_USER "spark-storage"
  env_set "$file" API_GW_HTTP_PORT "8000"
  env_set "$file" KONG_HTTP_PORT "8000"
  env_set "$file" KONG_HTTPS_PORT "8443"
  env_set "$file" IMGPROXY_AUTO_WEBP "true"

  # SMTP/OpenAI/OAuth/SAML credentials are external credentials, not generated.
  # Missing SMTP must not disable the email provider because password login for
  # existing confirmed-email users does not require SMTP. Mail-sending flows such
  # as recovery/confirmation remain unavailable until real SMTP is configured.
  if [[ -z "$(env_get "$file" SMTP_HOST)" || -z "$(env_get "$file" SMTP_USER)" || -z "$(env_get "$file" SMTP_PASS)" ]]; then
    env_set "$file" SMTP_ADMIN_EMAIL "$LE_EMAIL"
    env_set "$file" SMTP_PORT "587"
    env_set "$file" SMTP_SENDER_NAME "Spark"
  fi
  chmod 600 "$file"
}

test_extended_supabase_env() {
  local file="${SUPABASE_ROOT}/.env" key
  env_expect_exact "$file" COMPOSE_FILE "docker-compose.yml" || return 1
  env_expect_exact "$file" POSTGRES_HOST "db" || return 1
  env_expect_exact "$file" POSTGRES_DB "postgres" || return 1
  env_expect_exact "$file" POSTGRES_PORT "5432" || return 1
  env_expect_exact "$file" JWT_EXPIRY "3600" || return 1
  env_expect_exact "$file" DASHBOARD_USERNAME "supabase" || return 1
  env_expect_exact "$file" ENABLE_EMAIL_SIGNUP "true" || return 1
  env_expect_exact "$file" DISABLE_SIGNUP "true" || return 1
  env_expect_exact "$file" DOCKER_SOCKET_LOCATION "/var/run/docker.sock" || return 1
  env_expect_exact "$file" FUNCTIONS_VERIFY_JWT "false" || return 1
  for key in POOLER_TENANT_ID STORAGE_TENANT_ID POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY DASHBOARD_PASSWORD SECRET_KEY_BASE REALTIME_DB_ENC_KEY VAULT_ENC_KEY PG_META_CRYPTO_KEY LOGFLARE_PUBLIC_ACCESS_TOKEN LOGFLARE_PRIVATE_ACCESS_TOKEN S3_PROTOCOL_ACCESS_KEY_ID S3_PROTOCOL_ACCESS_KEY_SECRET MINIO_ROOT_PASSWORD SEND_SMS_HOOK_SECRET PHONE_RATE_LIMIT_PEPPER PHONE_PASSWORD_RESET_SECRET DAILY_REPORT_CRON_SECRET NOTIFICATION_OUTBOX_CRON_SECRET MINUTES_REMINDER_CRON_SECRET DECISION_DUE_CRON_SECRET SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY ANON_KEY_ASYMMETRIC SERVICE_ROLE_KEY_ASYMMETRIC JWT_KEYS JWT_JWKS; do
    env_require_real "$file" "$key" || return 1
  done
  modern_auth_keys_valid || { env_validation_error "JWT_KEYS/JWT_JWKS or opaque API keys are inconsistent with JWT_SECRET"; return 1; }
}

# Replace the silent validator with one that logs the exact failing key.
test_supabase_env() {
  local file="${SUPABASE_ROOT}/.env" key
  env_expect_exact "$file" COMPOSE_FILE "docker-compose.yml" || return 1
  env_expect_exact "$file" SUPABASE_PUBLIC_URL "https://${API_DOMAIN}" || return 1
  env_expect_exact "$file" API_EXTERNAL_URL "https://${API_DOMAIN}/auth/v1" || return 1
  env_expect_exact "$file" SITE_URL "https://${APP_DOMAIN}" || return 1
  env_expect_exact "$file" PROXY_DOMAIN "$API_DOMAIN" || return 1
  env_expect_exact "$file" CERTBOT_EMAIL "$LE_EMAIL" || return 1
  env_expect_exact "$file" POSTGRES_HOST "db" || return 1
  env_expect_exact "$file" POSTGRES_DB "postgres" || return 1
  env_expect_exact "$file" POSTGRES_PORT "5432" || return 1
  env_expect_exact "$file" ENABLE_EMAIL_SIGNUP "true" || return 1
  env_expect_exact "$file" DISABLE_SIGNUP "true" || return 1
  env_expect_exact "$file" FUNCTIONS_VERIFY_JWT "false" || return 1
  for key in POOLER_TENANT_ID STORAGE_TENANT_ID SEND_SMS_HOOK_SECRET PHONE_RATE_LIMIT_PEPPER PHONE_PASSWORD_RESET_SECRET DAILY_REPORT_CRON_SECRET NOTIFICATION_OUTBOX_CRON_SECRET MINUTES_REMINDER_CRON_SECRET DECISION_DUE_CRON_SECRET; do
    env_require_real "$file" "$key" || return 1
  done
  return 0
}

install_step_6() {
  install_step_6_base || return 1
  if ! run_logged "Generate/validate modern Supabase auth keys" ensure_modern_auth_keys; then
    unmark_step 6
    return 1
  fi
  if ! run_logged "Validate complete Supabase secret set" test_extended_supabase_env_secrets_only; then
    unmark_step 6
    return 1
  fi
  mark_step 6
}

test_extended_supabase_env_secrets_only() {
  local file="${SUPABASE_ROOT}/.env" key
  for key in POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY DASHBOARD_PASSWORD SECRET_KEY_BASE REALTIME_DB_ENC_KEY VAULT_ENC_KEY PG_META_CRYPTO_KEY LOGFLARE_PUBLIC_ACCESS_TOKEN LOGFLARE_PRIVATE_ACCESS_TOKEN S3_PROTOCOL_ACCESS_KEY_ID S3_PROTOCOL_ACCESS_KEY_SECRET MINIO_ROOT_PASSWORD POOLER_TENANT_ID STORAGE_TENANT_ID SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY ANON_KEY_ASYMMETRIC SERVICE_ROLE_KEY_ASYMMETRIC JWT_KEYS JWT_JWKS; do
    env_require_real "$file" "$key" || return 1
  done
  modern_auth_keys_valid || { env_validation_error "modern auth key set is invalid or stale"; return 1; }
}

install_step_7() {
  # Self-heal internal identifiers even when Environment is run directly.
  ensure_internal_identifier POOLER_TENANT_ID "spark-"
  ensure_internal_identifier STORAGE_TENANT_ID "spark-"
  install_step_7_base || return 1
  complete_reference_env_defaults || return 1
  ensure_modern_auth_keys || return 1
  if run_logged "Validate complete .env including modern auth/JWKS" test_extended_supabase_env; then
    mark_step 7
  else
    unmark_step 7
    return 1
  fi
}

wire_modern_auth_compose() {
  local compose_file="${SUPABASE_ROOT}/docker-compose.yml"
  COMPOSE_FILE="$compose_file" python3 - <<'PY'
import os,yaml
from pathlib import Path
p=Path(os.environ['COMPOSE_FILE'])
data=yaml.safe_load(p.read_text(encoding='utf-8'))
services=data.get('services') or {}
required=['api-gw','auth','rest','realtime','storage','functions']
missing=[x for x in required if x not in services]
if missing: raise SystemExit(f'Missing services for modern auth wiring: {missing}')
def envdict(v):
    if v is None: return {}
    if isinstance(v,dict): return dict(v)
    if isinstance(v,list):
        out={}
        for item in v:
            if isinstance(item,str):
                if '=' in item: k,val=item.split('=',1); out[k]=val
                else: out[item]=None
            elif isinstance(item,dict): out.update(item)
        return out
    raise SystemExit('unsupported environment format')
for name in required:
    services[name]['environment']=envdict(services[name].get('environment'))
services['api-gw']['environment']['SUPABASE_PUBLISHABLE_KEY']='${SUPABASE_PUBLISHABLE_KEY}'
services['api-gw']['environment']['SUPABASE_SECRET_KEY']='${SUPABASE_SECRET_KEY}'
services['auth']['environment']['GOTRUE_JWT_KEYS']='${JWT_KEYS}'
services['rest']['environment']['PGRST_JWT_SECRET']='${JWT_JWKS}'
services['realtime']['environment']['API_JWT_JWKS']='${JWT_JWKS}'
services['storage']['environment']['JWT_JWKS']='${JWT_JWKS}'
services['functions']['environment']['SUPABASE_JWKS']='${JWT_JWKS}'
services['functions']['environment']['SUPABASE_PUBLISHABLE_KEYS']='{"default":"${SUPABASE_PUBLISHABLE_KEY}"}'
services['functions']['environment']['SUPABASE_SECRET_KEYS']='{"default":"${SUPABASE_SECRET_KEY}"}'
p.write_text(yaml.safe_dump(data,sort_keys=False,default_flow_style=False),encoding='utf-8')
PY
}

patch_compose() {
  patch_compose_base || return 1
  wire_modern_auth_compose
}

# Step 04 installs Manager directly from the local Spark repository.
install_step_4() {
  title
  new_log "install-04-spark-repo"
  mkdir -p /opt
  if [[ -d "${SPARK_ROOT}/.git" ]]; then
    if [[ -n "$(git -C "$SPARK_ROOT" status --porcelain)" ]]; then
      fail "${SPARK_ROOT} تغییرات commit نشده دارد؛ برای جلوگیری از overwrite مرحله متوقف شد."
      git -C "$SPARK_ROOT" status --short | tee -a "$CURRENT_LOG"
      return 1
    fi
    run_logged "Fetch آخرین Spark main" git -C "$SPARK_ROOT" fetch origin main || return 1
    run_logged "Checkout Spark main" git -C "$SPARK_ROOT" checkout main || return 1
    run_logged "Fast-forward Spark main" git -C "$SPARK_ROOT" pull --ff-only origin main || return 1
  elif [[ -e "$SPARK_ROOT" ]]; then
    fail "${SPARK_ROOT} وجود دارد ولی Git repository نیست."
    return 1
  else
    run_logged "Clone آخرین Spark main" git clone --branch main --single-branch "$REPO_URL" "$SPARK_ROOT" || return 1
  fi
  if [[ -f "${SPARK_ROOT}/deploy/spark-cli/spark" ]]; then
    run_logged "نصب/به‌روزرسانی Spark Manager" install_manager_from_dir "${SPARK_ROOT}/deploy/spark-cli" || return 1
  fi
  if run_logged "تست repository" test_spark_repo; then
    mark_step 4
  else
    unmark_step 4
    return 1
  fi
}
