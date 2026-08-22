check_ubuntu_2404() {
  . /etc/os-release
  [[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] || {
    echo "Expected Ubuntu 24.04; got ID=${ID:-?} VERSION_ID=${VERSION_ID:-?}" >>"$CURRENT_LOG"
    return 1
  }
  [[ "$(dpkg --print-architecture)" == "amd64" ]] || {
    echo "Expected amd64 architecture" >>"$CURRENT_LOG"
    return 1
  }
}

test_dns() {
  local d ip resolved
  ip="$TURN_PUBLIC_IP"
  for d in "$APP_DOMAIN" "$WWW_DOMAIN" "$API_DOMAIN" "$TURN_DOMAIN"; do
    resolved="$(getent ahostsv4 "$d" 2>>"$CURRENT_LOG" | awk '{print $1}' | sort -u || true)"
    printf '%s -> %s\n' "$d" "$resolved" >>"$CURRENT_LOG"
    grep -Fxq "$ip" <<<"$resolved" || return 1
  done
}

test_values() {
  require_manager_values || return 1
  valid_domain "$APP_DOMAIN" || return 1
  valid_domain "$WWW_DOMAIN" || return 1
  valid_domain "$API_DOMAIN" || return 1
  valid_domain "$TURN_DOMAIN" || return 1
  valid_ipv4 "$TURN_PUBLIC_IP" || return 1
  valid_ipv4 "$TURN_PRIVATE_IP" || return 1
  valid_email "$LE_EMAIL" || return 1
}

install_step_2() {
  title
  new_log "install-02-values"
  configure_values_interactive || return 1
  if run_logged "اعتبارسنجی مقادیر نصب" test_values; then
    mark_step 2
  else
    unmark_step 2
    return 1
  fi
}

test_base_packages() {
  command -v docker || return 1
  docker compose version || return 1
  command -v nginx || return 1
  command -v certbot || return 1
  command -v turnserver || return 1
  command -v rsync || return 1
  command -v jq || return 1
  command -v python3 || return 1
  node -e 'const [M,m,p]=process.versions.node.split(".").map(Number); if (!(M===24 && (m>18 || (m===18 && p>=1)))) process.exit(1)' || return 1
  npm --version || return 1
  systemctl is-active --quiet docker || return 1
  systemctl is-active --quiet nginx || return 1
}

install_step_3() {
  title
  new_log "install-03-packages"
  run_logged "بررسی Ubuntu 24.04 x86_64" check_ubuntu_2404 || return 1
  run_logged "apt update" apt update || return 1
  run_logged "apt upgrade" apt upgrade -y || return 1
  run_logged "نصب packageهای پایه" apt install -y ca-certificates curl git gnupg jq openssl ufw rsync python3 python3-yaml nginx certbot coturn || return 1

  run_logged "تنظیم repository رسمی Docker" bash -c '
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    cat >/etc/apt/sources.list.d/docker.list <<EOF
deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable
EOF
  ' || return 1

  run_logged "تنظیم NodeSource Node 24" bash -c '
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    chmod a+r /etc/apt/keyrings/nodesource.gpg
    cat >/etc/apt/sources.list.d/nodesource.list <<EOF
deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main
EOF
  ' || return 1

  run_logged "نصب Docker و Node.js" bash -c 'apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin nodejs' || return 1
  run_logged "نصب npm 11" npm install -g 'npm@^11.6.2' || return 1
  run_logged "فعال‌سازی Docker و Nginx" systemctl enable --now docker nginx || return 1
  if run_logged "تست packageها و versionها" test_base_packages; then
    mark_step 3
  else
    unmark_step 3
    return 1
  fi
}

test_spark_repo() {
  git -C "$SPARK_ROOT" rev-parse --is-inside-work-tree || return 1
  [[ "$(git -C "$SPARK_ROOT" remote get-url origin)" == "$REPO_URL" ]] || return 1
  [[ "$(git -C "$SPARK_ROOT" branch --show-current)" == "main" ]] || return 1
  require_file "${SPARK_ROOT}/package.json" || return 1
  require_file "${SPARK_ROOT}/package-lock.json" || return 1
  require_dir "${SPARK_ROOT}/supabase/functions" || return 1
}

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

test_supabase_source() {
  require_dir "${SUPABASE_SOURCE}/.git" || return 1
  require_file "${SUPABASE_SOURCE}/docker/docker-compose.yml" || return 1
  require_file "${SUPABASE_ROOT}/docker-compose.yml" || return 1
  require_file "${SUPABASE_ROOT}/.env" || return 1
  [[ "$(git -C "$SUPABASE_SOURCE" remote get-url origin)" == "https://github.com/supabase/supabase.git" ]] || return 1
  [[ "$(git -C "$SUPABASE_SOURCE" branch --show-current)" == "main" ]] || return 1
  local actual latest
  actual="$(git -C "$SUPABASE_SOURCE" rev-parse HEAD)" || return 1
  latest="$(git -C "$SUPABASE_SOURCE" rev-parse origin/main)" || return 1
  [[ "$actual" == "$latest" ]] || return 1
}

install_step_5() {
  title
  new_log "install-05-supabase-latest"

  if [[ -d "${SUPABASE_SOURCE}/.git" ]]; then
    if [[ -n "$(git -C "$SUPABASE_SOURCE" status --porcelain)" ]]; then
      fail "${SUPABASE_SOURCE} تغییرات commit نشده دارد؛ برای جلوگیری از overwrite مرحله متوقف شد."
      git -C "$SUPABASE_SOURCE" status --short | tee -a "$CURRENT_LOG"
      return 1
    fi
    run_logged "Fetch آخرین Supabase main" git -C "$SUPABASE_SOURCE" fetch origin main || return 1
    run_logged "Checkout Supabase main" git -C "$SUPABASE_SOURCE" checkout main || return 1
    run_logged "Fast-forward Supabase main" git -C "$SUPABASE_SOURCE" pull --ff-only origin main || return 1
  elif [[ -e "$SUPABASE_SOURCE" ]]; then
    fail "${SUPABASE_SOURCE} وجود دارد ولی Git repository نیست."
    return 1
  else
    run_logged "Clone آخرین Supabase رسمی" git clone --branch main --single-branch https://github.com/supabase/supabase.git "$SUPABASE_SOURCE" || return 1
  fi

  if [[ -f "${SUPABASE_ROOT}/.env" ]]; then
    warn "${SUPABASE_ROOT} از قبل فعال است؛ Source رسمی به آخرین main به‌روزرسانی شد ولی runtime/config زنده overwrite نمی‌شود."
    rm -f "${SUPABASE_ROOT}/.spark-supabase-source-commit"
  else
    rm -rf "$SUPABASE_ROOT"
    mkdir -p "$SUPABASE_ROOT"
    run_logged "کپی آخرین Docker snapshot رسمی Supabase" cp -a "${SUPABASE_SOURCE}/docker/." "$SUPABASE_ROOT/" || return 1
    run_logged "ایجاد .env اولیه" cp "${SUPABASE_ROOT}/.env.example" "${SUPABASE_ROOT}/.env" || return 1
    chmod 600 "${SUPABASE_ROOT}/.env"
    rm -f "${SUPABASE_ROOT}/.spark-supabase-source-commit"
  fi

  if run_logged "تست آخرین Supabase source و runtime" test_supabase_source; then
    mark_step 5
  else
    unmark_step 5
    return 1
  fi
}

generate_jwt() {
  local role="$1" jwt_secret="$2"
  ROLE="$role" JWT_SECRET_VALUE="$jwt_secret" python3 - <<'PY'
import os,time,json,base64,hmac,hashlib
def e(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
h=e(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
now=int(time.time())
p=e(json.dumps({"role":os.environ["ROLE"],"iss":"supabase","iat":now,"exp":now+5*365*24*3600},separators=(",",":")).encode())
s=e(hmac.new(os.environ["JWT_SECRET_VALUE"].encode(),f"{h}.{p}".encode(),hashlib.sha256).digest())
print(f"{h}.{p}.{s}")
PY
}

is_placeholder_value() {
  local value="${1:-}"
  [[ -z "$value" ]] && return 1
  case "$value" in
    your-tenant-id|stub|your-domain.example.com|admin@example.com|GOOGLE_PROJECT_ID|GOOGLE_PROJECT_NUMBER|sk-proj-xxxxxxxx|fake_mail_user|fake_mail_password|fake_sender)
      return 0 ;;
  esac
  [[ "$value" == *xxxxxxxx* || "$value" == *YOUR_* || "$value" == *CHANGE_ME* ]]
}

ensure_fresh_secret() {
  local key="$1" generator="$2"
  local file="${SUPABASE_ROOT}/.env" example="${SUPABASE_ROOT}/.env.example"
  local current sample value
  current="$(env_get "$file" "$key")"
  sample="$(env_get "$example" "$key")"
  if [[ -z "$current" || "$current" == "$sample" ]] || is_placeholder_value "$current"; then
    value="$(eval "$generator")"
    env_set "$file" "$key" "$value"
  fi
}

ensure_internal_identifier() {
  local key="$1" prefix="$2" current sample
  current="$(env_get "${SUPABASE_ROOT}/.env" "$key")"
  sample="$(env_get "${SUPABASE_ROOT}/.env.example" "$key")"
  if [[ -z "$current" || "$current" == "$sample" ]] || is_placeholder_value "$current"; then
    env_set "${SUPABASE_ROOT}/.env" "$key" "${prefix}$(openssl rand -hex 8)"
  fi
}

test_supabase_secrets() {
  local key current sample
  local keys=(
    POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY DASHBOARD_PASSWORD
    SECRET_KEY_BASE REALTIME_DB_ENC_KEY VAULT_ENC_KEY PG_META_CRYPTO_KEY
    LOGFLARE_PUBLIC_ACCESS_TOKEN LOGFLARE_PRIVATE_ACCESS_TOKEN
    S3_PROTOCOL_ACCESS_KEY_ID S3_PROTOCOL_ACCESS_KEY_SECRET MINIO_ROOT_PASSWORD
    POOLER_TENANT_ID STORAGE_TENANT_ID
  )
  for key in "${keys[@]}"; do
    current="$(env_get "${SUPABASE_ROOT}/.env" "$key")"
    sample="$(env_get "${SUPABASE_ROOT}/.env.example" "$key")"
    [[ -n "$current" ]] || return 1
    [[ -z "$sample" || "$current" != "$sample" ]] || return 1
    is_placeholder_value "$current" && return 1
  done
  [[ "$(stat -c '%a' "${SUPABASE_ROOT}/.env")" == "600" ]]
}

install_step_6() {
  title
  new_log "install-06-secrets"
  require_file "${SUPABASE_ROOT}/.env" || return 1
  require_file "${SUPABASE_ROOT}/.env.example" || return 1

  info "Secretها و شناسه‌های داخلی موجود حفظ می‌شوند؛ فقط empty/default/placeholderها جایگزین می‌شوند."
  ensure_fresh_secret POSTGRES_PASSWORD "openssl rand -hex 16"
  ensure_fresh_secret JWT_SECRET "openssl rand -base64 30 | tr -d '\n'"
  ensure_fresh_secret SECRET_KEY_BASE "openssl rand -base64 48 | tr -d '\n'"
  ensure_fresh_secret REALTIME_DB_ENC_KEY "openssl rand -hex 8"
  ensure_fresh_secret VAULT_ENC_KEY "openssl rand -hex 16"
  ensure_fresh_secret PG_META_CRYPTO_KEY "openssl rand -base64 24 | tr -d '\n'"
  ensure_fresh_secret LOGFLARE_PUBLIC_ACCESS_TOKEN "openssl rand -base64 24 | tr -d '\n'"
  ensure_fresh_secret LOGFLARE_PRIVATE_ACCESS_TOKEN "openssl rand -base64 24 | tr -d '\n'"
  ensure_fresh_secret S3_PROTOCOL_ACCESS_KEY_ID "openssl rand -hex 16"
  ensure_fresh_secret S3_PROTOCOL_ACCESS_KEY_SECRET "openssl rand -hex 32"
  ensure_fresh_secret MINIO_ROOT_PASSWORD "openssl rand -hex 16"
  ensure_fresh_secret DASHBOARD_PASSWORD "openssl rand -hex 16"
  ensure_internal_identifier POOLER_TENANT_ID "spark-"
  ensure_internal_identifier STORAGE_TENANT_ID "spark-"

  local jwt anon service sample_anon sample_service
  jwt="$(env_get "${SUPABASE_ROOT}/.env" JWT_SECRET)"
  anon="$(env_get "${SUPABASE_ROOT}/.env" ANON_KEY)"
  service="$(env_get "${SUPABASE_ROOT}/.env" SERVICE_ROLE_KEY)"
  sample_anon="$(env_get "${SUPABASE_ROOT}/.env.example" ANON_KEY)"
  sample_service="$(env_get "${SUPABASE_ROOT}/.env.example" SERVICE_ROLE_KEY)"
  if [[ -z "$anon" || "$anon" == "$sample_anon" ]] || is_placeholder_value "$anon"; then
    env_set "${SUPABASE_ROOT}/.env" ANON_KEY "$(generate_jwt anon "$jwt")"
  fi
  if [[ -z "$service" || "$service" == "$sample_service" ]] || is_placeholder_value "$service"; then
    env_set "${SUPABASE_ROOT}/.env" SERVICE_ROLE_KEY "$(generate_jwt service_role "$jwt")"
  fi
  chmod 600 "${SUPABASE_ROOT}/.env"

  if run_logged "اعتبارسنجی Secretها و شناسه‌های داخلی بدون نمایش مقدار" test_supabase_secrets; then
    mark_step 6
  else
    unmark_step 6
    return 1
  fi
}

normalize_optional_external_env() {
  local file="$1"
  local smtp_host smtp_user smtp_pass openai
  openai="$(env_get "$file" OPENAI_API_KEY)"
  if is_placeholder_value "$openai"; then env_set "$file" OPENAI_API_KEY ""; fi

  smtp_host="$(env_get "$file" SMTP_HOST)"
  smtp_user="$(env_get "$file" SMTP_USER)"
  smtp_pass="$(env_get "$file" SMTP_PASS)"
  if is_placeholder_value "$smtp_host" || is_placeholder_value "$smtp_user" || is_placeholder_value "$smtp_pass"; then
    env_set "$file" ENABLE_EMAIL_SIGNUP "false"
    env_set "$file" SMTP_ADMIN_EMAIL "$LE_EMAIL"
    env_set "$file" SMTP_HOST ""
    env_set "$file" SMTP_PORT "587"
    env_set "$file" SMTP_USER ""
    env_set "$file" SMTP_PASS ""
    env_set "$file" SMTP_SENDER_NAME "Spark"
  fi
  env_set "$file" GOOGLE_PROJECT_ID ""
  env_set "$file" GOOGLE_PROJECT_NUMBER ""
}

test_supabase_env() {
  local file="${SUPABASE_ROOT}/.env" key value
  [[ "$(env_get "$file" COMPOSE_FILE)" == "docker-compose.yml" ]] || return 1
  [[ "$(env_get "$file" SUPABASE_PUBLIC_URL)" == "https://${API_DOMAIN}" ]] || return 1
  [[ "$(env_get "$file" API_EXTERNAL_URL)" == "https://${API_DOMAIN}/auth/v1" ]] || return 1
  [[ "$(env_get "$file" SITE_URL)" == "https://${APP_DOMAIN}" ]] || return 1
  [[ "$(env_get "$file" PROXY_DOMAIN)" == "$API_DOMAIN" ]] || return 1
  [[ "$(env_get "$file" CERTBOT_EMAIL)" == "$LE_EMAIL" ]] || return 1
  [[ "$(env_get "$file" POSTGRES_HOST)" == "db" ]] || return 1
  [[ "$(env_get "$file" POSTGRES_DB)" == "postgres" ]] || return 1
  [[ "$(env_get "$file" POSTGRES_PORT)" == "5432" ]] || return 1
  [[ "$(env_get "$file" FUNCTIONS_VERIFY_JWT)" == "false" ]] || return 1
  for key in POOLER_TENANT_ID STORAGE_TENANT_ID SEND_SMS_HOOK_SECRET PHONE_RATE_LIMIT_PEPPER PHONE_PASSWORD_RESET_SECRET DAILY_REPORT_CRON_SECRET NOTIFICATION_OUTBOX_CRON_SECRET MINUTES_REMINDER_CRON_SECRET DECISION_DUE_CRON_SECRET; do
    value="$(env_get "$file" "$key")"
    [[ -n "$value" ]] || return 1
    is_placeholder_value "$value" && return 1
  done
  for key in OPENAI_API_KEY SMTP_HOST SMTP_USER SMTP_PASS GOOGLE_PROJECT_ID GOOGLE_PROJECT_NUMBER; do
    value="$(env_get "$file" "$key")"
    is_placeholder_value "$value" && return 1
  done
}

install_step_7() {
  title
  new_log "install-07-supabase-env"
  require_manager_values || return 1
  require_file "${SUPABASE_ROOT}/.env" || return 1
  local file="${SUPABASE_ROOT}/.env"

  env_set "$file" COMPOSE_FILE "docker-compose.yml"
  env_set "$file" SUPABASE_PUBLIC_URL "https://${API_DOMAIN}"
  env_set "$file" API_EXTERNAL_URL "https://${API_DOMAIN}/auth/v1"
  env_set "$file" SITE_URL "https://${APP_DOMAIN}"
  env_set "$file" ADDITIONAL_REDIRECT_URLS "https://${APP_DOMAIN}/*,https://${WWW_DOMAIN}/*"
  env_set "$file" POSTGRES_HOST "db"
  env_set "$file" POSTGRES_DB "postgres"
  env_set "$file" POSTGRES_PORT "5432"
  env_set "$file" POOLER_PROXY_PORT_TRANSACTION "6543"
  env_set "$file" POOLER_DEFAULT_POOL_SIZE "20"
  env_set "$file" POOLER_MAX_CLIENT_CONN "100"
  env_set "$file" POOLER_DB_POOL_SIZE "5"
  env_set "$file" STUDIO_DEFAULT_ORGANIZATION "Spark"
  env_set "$file" STUDIO_DEFAULT_PROJECT "Spark Production"
  env_set "$file" PGRST_DB_SCHEMAS "public,graphql_public"
  env_set "$file" PGRST_DB_MAX_ROWS "1000"
  env_set "$file" PGRST_DB_EXTRA_SEARCH_PATH "public"
  env_set "$file" API_GW_HTTP_PORT "8000"
  env_set "$file" KONG_HTTP_PORT "8000"
  env_set "$file" KONG_HTTPS_PORT "8443"
  env_set "$file" GLOBAL_S3_BUCKET "spark-storage"
  env_set "$file" REGION "local"
  env_set "$file" MINIO_ROOT_USER "spark-storage"
  env_set "$file" FUNCTIONS_VERIFY_JWT "false"
  env_set "$file" IMGPROXY_AUTO_WEBP "true"
  env_set "$file" PROXY_DOMAIN "$API_DOMAIN"
  env_set "$file" CERTBOT_EMAIL "$LE_EMAIL"
  env_set "$file" PHONE_LOGIN_ALLOWED_ORIGINS "https://${APP_DOMAIN},https://${WWW_DOMAIN}"

  env_has_nonempty "$file" SEND_SMS_HOOK_SECRET || env_set "$file" SEND_SMS_HOOK_SECRET "v1,whsec_$(openssl rand -base64 32 | tr -d '\n')"
  env_has_nonempty "$file" PHONE_RATE_LIMIT_PEPPER || env_set "$file" PHONE_RATE_LIMIT_PEPPER "$(openssl rand -hex 32)"
  env_has_nonempty "$file" PHONE_PASSWORD_RESET_SECRET || env_set "$file" PHONE_PASSWORD_RESET_SECRET "$(openssl rand -hex 32)"
  env_has_nonempty "$file" DAILY_REPORT_CRON_SECRET || env_set "$file" DAILY_REPORT_CRON_SECRET "$(openssl rand -hex 32)"
  env_has_nonempty "$file" NOTIFICATION_OUTBOX_CRON_SECRET || env_set "$file" NOTIFICATION_OUTBOX_CRON_SECRET "$(openssl rand -hex 32)"
  env_has_nonempty "$file" MINUTES_REMINDER_CRON_SECRET || env_set "$file" MINUTES_REMINDER_CRON_SECRET "$(openssl rand -hex 32)"
  env_has_nonempty "$file" DECISION_DUE_CRON_SECRET || env_set "$file" DECISION_DUE_CRON_SECRET "$(openssl rand -hex 32)"

  normalize_optional_external_env "$file"
  chmod 600 "$file"

  if grep -Eq 'GOTRUE_JWT_KEYS|API_JWT_JWKS|SUPABASE_JWKS|JWT_JWKS' "${SUPABASE_ROOT}/docker-compose.yml"; then
    info "Asymmetric/JWKS variables are optional in this runtime; empty values are retained and legacy JWT_SECRET remains active."
  fi

  if run_logged "تست کامل تنظیمات .env و عدم وجود placeholder فعال" test_supabase_env; then
    mark_step 7
  else
    unmark_step 7
    return 1
  fi
}

test_function_sync() {
  diff -qr --exclude=main "${SPARK_ROOT}/supabase/functions" "${SUPABASE_ROOT}/volumes/functions" || return 1
  diff -qr "${SUPABASE_SOURCE}/docker/volumes/functions/main" "${SUPABASE_ROOT}/volumes/functions/main" || return 1
}

install_step_8() {
  title
  new_log "install-08-functions"
  require_dir "${SPARK_ROOT}/supabase/functions" || return 1
  require_dir "${SUPABASE_SOURCE}/docker/volumes/functions/main" || return 1
  mkdir -p "${SUPABASE_ROOT}/volumes/functions"
  run_logged "Sync تمام Edge Functions" rsync -a --delete "${SPARK_ROOT}/supabase/functions/" "${SUPABASE_ROOT}/volumes/functions/" || return 1
  rm -rf "${SUPABASE_ROOT}/volumes/functions/main"
  run_logged "Restore رسمی Main Router از Supabase رسمی" cp -a "${SUPABASE_SOURCE}/docker/volumes/functions/main" "${SUPABASE_ROOT}/volumes/functions/main" || return 1
  if run_logged "تست تطابق Edge Functions و Main Router" test_function_sync; then
    mark_step 8
  else
    unmark_step 8
    return 1
  fi
}

scan_function_env_names() {
  python3 - "$SPARK_ROOT/supabase/functions" <<'PY'
import re,sys
from pathlib import Path
root=Path(sys.argv[1])
patterns=[
    re.compile(r'Deno\.env\.get\(\s*["\']([A-Z][A-Z0-9_]*)["\']\s*\)'),
    re.compile(r'(?:requiredEnv|getEnv|readEnv)\(\s*["\']([A-Z][A-Z0-9_]*)["\']\s*\)'),
]
names=set()
for path in root.rglob("*"):
    if path.suffix not in {".ts",".tsx",".js",".mjs"} or not path.is_file():
        continue
    try: text=path.read_text(encoding="utf-8")
    except Exception: continue
    for pat in patterns:
        names.update(pat.findall(text))
for name in sorted(names):
    print(name)
PY
}

configure_optional_function_env() {
  local extra="${CONFIG_DIR}/functions-extra.env"
  touch "$extra"
  chmod 600 "$extra"
  local core='^(SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET|SEND_SMS_HOOK_SECRET|PHONE_RATE_LIMIT_PEPPER|PHONE_PASSWORD_RESET_SECRET|PHONE_LOGIN_ALLOWED_ORIGINS|DAILY_REPORT_CRON_SECRET|NOTIFICATION_OUTBOX_CRON_SECRET|MINUTES_REMINDER_CRON_SECRET|DECISION_DUE_CRON_SECRET|TURN_DOMAIN|TURN_SHARED_SECRET|TURN_URL|TURN_TCP_URL|TURNS_URL)$'
  local key existing base_value answer
  mapfile -t detected < <(scan_function_env_names)
  if ((${#detected[@]} == 0)); then
    warn "متغیر provider مشخصی با الگوهای شناخته‌شده پیدا نشد؛ فایل extra env خالی/موجود حفظ شد."
    return 0
  fi
  info "Provider envهای موردنیاز از source فعلی scan شدند. برای موارد اختیاری می‌توانید Enter بزنید."
  for key in "${detected[@]}"; do
    [[ "$key" =~ $core ]] && continue
    existing="$(env_get "$extra" "$key")"
    base_value="$(env_get "${SUPABASE_ROOT}/.env" "$key")"
    [[ -n "$existing" || -n "$base_value" ]] && continue
    read -r -s -p "${key} (Enter=skip): " answer
    printf '\n'
    [[ -n "$answer" ]] && env_set "$extra" "$key" "$answer"
  done
}

test_provider_env() {
  local service_role
  service_role="$(env_get "${SUPABASE_ROOT}/.env" SERVICE_ROLE_KEY)" || return 1
  [[ -n "$service_role" ]] || return 1
  [[ "$(env_get "${CONFIG_DIR}/avatar-worker.env" SUPABASE_URL)" == "http://kong:8000" ]] || return 1
  [[ "$(env_get "${CONFIG_DIR}/avatar-worker.env" SUPABASE_SERVICE_ROLE_KEY)" == "$service_role" ]] || return 1
  [[ "$(stat -c '%a' "${CONFIG_DIR}/avatar-worker.env")" == "600" ]] || return 1
  [[ "$(stat -c '%a' "${CONFIG_DIR}/functions-extra.env")" == "600" ]] || return 1
}

install_step_9() {
  title
  new_log "install-09-provider-env"
  require_file "${SUPABASE_ROOT}/.env" || return 1
  mkdir -p "$CONFIG_DIR"
  chmod 700 "$CONFIG_DIR"
  local service_role
  service_role="$(env_get "${SUPABASE_ROOT}/.env" SERVICE_ROLE_KEY)"
  [[ -n "$service_role" ]] || { fail "SERVICE_ROLE_KEY موجود نیست؛ ابتدا مرحله 6 را اجرا کنید."; return 1; }
  env_set "${CONFIG_DIR}/avatar-worker.env" SUPABASE_URL "http://kong:8000"
  env_set "${CONFIG_DIR}/avatar-worker.env" SUPABASE_SERVICE_ROLE_KEY "$service_role"
  env_set "${CONFIG_DIR}/avatar-worker.env" AVATAR_WORKER_ID "avatar-worker-single"
  chmod 600 "${CONFIG_DIR}/avatar-worker.env"
  configure_optional_function_env
  chmod 600 "${CONFIG_DIR}/functions-extra.env"

  if run_logged "تست Provider/Worker env" test_provider_env; then
    mark_step 9
  else
    unmark_step 9
    return 1
  fi
}
