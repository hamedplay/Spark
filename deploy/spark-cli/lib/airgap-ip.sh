# Internal-IP-only Air-Gap deployment mode.
# Loaded last by spark-airgap so the normal online installer remains unchanged.
# Public DNS, public IP selection and TLS termination are intentionally owned by
# the bank security / ingress layer and are not prerequisites for this workflow.

AIRGAP_IP_CONF="${CONFIG_DIR}/airgap-ip.conf"
AIRGAP_IP_MODE="internal_ip"

# Preserve the generic implementations we intentionally extend.
eval "$(declare -f save_config | sed '1s/save_config/save_config_standard/')"
eval "$(declare -f patch_compose | sed '1s/patch_compose/patch_compose_standard/')"
eval "$(declare -f install_step_10 | sed '1s/install_step_10/install_step_10_airgap_base/')"
eval "$(declare -f airgap_status | sed '1s/airgap_status/airgap_status_airgap_base/')"
eval "$(declare -f airgap_build_bundle | sed '1s/airgap_build_bundle/airgap_build_bundle_legacy/')"
eval "$(declare -f airgap_import_bundle | sed '1s/airgap_import_bundle/airgap_import_bundle_legacy/')"

# Load the target-local IP independently from manager.conf. core.sh rewrites
# manager.conf during startup, so the dedicated file is the authoritative source.
if [[ -f "$AIRGAP_IP_CONF" ]]; then
  # shellcheck disable=SC1090
  source "$AIRGAP_IP_CONF"
fi

# Compatibility values keep unchanged production helpers working without ever
# resolving a hostname. In this Air-Gap backend these variables all mean the
# same internal server IPv4 address, not public DNS/public addressing.
airgap_ip_apply_compat_values() {
  local ip="${AIRGAP_SERVER_IP:-}"
  [[ -n "$ip" ]] || return 0
  APP_DOMAIN="$ip"
  WWW_DOMAIN="$ip"
  API_DOMAIN="$ip"
  TURN_DOMAIN="$ip"
  TURN_PUBLIC_IP="$ip"
  TURN_PRIVATE_IP="$ip"
  LE_EMAIL="airgap@localhost.invalid"
  TURN_MIN_PORT="${TURN_MIN_PORT:-49160}"
  TURN_MAX_PORT="${TURN_MAX_PORT:-49200}"
}
airgap_ip_apply_compat_values

# New bundles are target-neutral: do not embed manager.conf or TLS certificate
# material. The internal IPv4 is always selected on the isolated target host.
airgap_build_bundle() {
  local dummy_dir rc
  dummy_dir="$(mktemp -d)"
  local MANAGER_CONF="${dummy_dir}/manager.conf"
  read() {
    local rendered="$*" var_name="${*: -1}"
    if [[ "$rendered" == *"TLS certificate pack source"* ]]; then
      printf -v "$var_name" '%s' ""
      return 0
    fi
    builtin read "$@"
  }
  set +e
  airgap_build_bundle_legacy
  rc=$?
  set -e
  unset -f read
  rm -rf "$dummy_dir"
  return "$rc"
}

# Old bundles may contain DNS-era manager.conf. Import the payload, but never
# restore that target configuration. Existing target-local configuration is
# left untouched and step 01 owns the internal IPv4 selection.
airgap_import_bundle() {
  local dummy_dir rc
  dummy_dir="$(mktemp -d)"
  local MANAGER_CONF="${dummy_dir}/manager.conf"
  set +e
  airgap_import_bundle_legacy "$@"
  rc=$?
  set -e
  rm -rf "$dummy_dir"
  return "$rc"
}

save_config() {
  airgap_ip_apply_compat_values
  save_config_standard || return 1
  [[ -n "${AIRGAP_SERVER_IP:-}" ]] || return 0
  umask 077
  local tmp
  tmp="$(mktemp)"
  {
    printf 'AIRGAP_MODE=%q\n' "$AIRGAP_IP_MODE"
    printf 'AIRGAP_SERVER_IP=%q\n' "$AIRGAP_SERVER_IP"
    printf 'TURN_MIN_PORT=%q\n' "${TURN_MIN_PORT:-49160}"
    printf 'TURN_MAX_PORT=%q\n' "${TURN_MAX_PORT:-49200}"
  } >"$tmp"
  install -m 0600 "$tmp" "$AIRGAP_IP_CONF"
  rm -f "$tmp"
}

airgap_ip_detect_default() {
  local candidate
  candidate="$(ip -o -4 addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | \
    awk '$1 ~ /^10\./ || $1 ~ /^192\.168\./ || $1 ~ /^172\.(1[6-9]|2[0-9]|3[01])\./ {print; exit}')"
  if [[ -z "$candidate" ]]; then
    candidate="$(ip -o -4 addr show scope global 2>/dev/null | awk 'NR==1 {split($4,a,"/"); print a[1]}')"
  fi
  printf '%s\n' "$candidate"
}

airgap_ip_is_local() {
  local ip="$1"
  valid_ipv4 "$ip" || return 1
  ip -o -4 addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -Fxq "$ip"
}

require_manager_values() {
  airgap_ip_apply_compat_values
  [[ -n "${AIRGAP_SERVER_IP:-}" ]] || {
    fail "Internal server IPv4 is not configured. Run Air-Gap install step 01 first."
    return 1
  }
  airgap_ip_is_local "$AIRGAP_SERVER_IP" || {
    fail "Configured Air-Gap IPv4 is not assigned to this server: $AIRGAP_SERVER_IP"
    return 1
  }
  [[ "${TURN_MIN_PORT:-}" =~ ^[0-9]+$ && "${TURN_MAX_PORT:-}" =~ ^[0-9]+$ ]] || return 1
  (( TURN_MIN_PORT < TURN_MAX_PORT && TURN_MIN_PORT >= 1024 && TURN_MAX_PORT <= 65535 )) || return 1
}

test_values() {
  require_manager_values
}

install_step_1() {
  title
  new_log "install-01-internal-ip"
  local candidate v
  candidate="${AIRGAP_SERVER_IP:-$(airgap_ip_detect_default)}"
  while true; do
    prompt_default v "Internal server IPv4" "$candidate"
    if airgap_ip_is_local "$v"; then
      AIRGAP_SERVER_IP="$v"
      break
    fi
    fail "IPv4 must be valid and assigned to a local interface on this server."
  done

  prompt_default TURN_MIN_PORT "TURN minimum relay port" "${TURN_MIN_PORT:-49160}"
  prompt_default TURN_MAX_PORT "TURN maximum relay port" "${TURN_MAX_PORT:-49200}"
  [[ "$TURN_MIN_PORT" =~ ^[0-9]+$ && "$TURN_MAX_PORT" =~ ^[0-9]+$ ]] || {
    fail "TURN ports must be numeric."
    return 1
  }
  (( TURN_MIN_PORT < TURN_MAX_PORT && TURN_MIN_PORT >= 1024 && TURN_MAX_PORT <= 65535 )) || {
    fail "TURN relay range is invalid."
    return 1
  }

  airgap_ip_apply_compat_values
  save_config || return 1
  if run_logged "Validate internal-IP Air-Gap configuration" test_values; then
    mark_step 1
    ok "Air-Gap origin is configured for internal IPv4 ${AIRGAP_SERVER_IP}."
    info "No DNS name, public IPv4 or certificate email is required."
  else
    unmark_step 1
    return 1
  fi
}

airgap_ip_base_url() {
  printf 'http://%s' "$AIRGAP_SERVER_IP"
}

test_supabase_env() {
  local file="${SUPABASE_ROOT}/.env" key value base
  base="$(airgap_ip_base_url)"
  [[ "$(env_get "$file" COMPOSE_FILE)" == "docker-compose.yml" ]] || return 1
  [[ "$(env_get "$file" SUPABASE_PUBLIC_URL)" == "$base" ]] || return 1
  [[ "$(env_get "$file" API_EXTERNAL_URL)" == "${base}/auth/v1" ]] || return 1
  [[ "$(env_get "$file" SITE_URL)" == "$base" ]] || return 1
  [[ "$(env_get "$file" PROXY_DOMAIN)" == "$AIRGAP_SERVER_IP" ]] || return 1
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

install_step_6() {
  title
  new_log "install-06-supabase-env-internal-ip"
  require_manager_values || return 1
  require_file "${SUPABASE_ROOT}/.env" || return 1
  local file="${SUPABASE_ROOT}/.env" base
  base="$(airgap_ip_base_url)"

  env_set "$file" COMPOSE_FILE "docker-compose.yml"
  env_set "$file" SUPABASE_PUBLIC_URL "$base"
  env_set "$file" API_EXTERNAL_URL "${base}/auth/v1"
  env_set "$file" SITE_URL "$base"
  env_set "$file" ADDITIONAL_REDIRECT_URLS "${base}/*"
  env_set "$file" POSTGRES_HOST "db"
  env_set "$file" POSTGRES_DB "postgres"
  env_set "$file" POSTGRES_PORT "5432"
  env_set "$file" POOLER_PROXY_PORT_TRANSACTION "6543"
  env_set "$file" POOLER_DEFAULT_POOL_SIZE "20"
  env_set "$file" POOLER_MAX_CLIENT_CONN "100"
  env_set "$file" POOLER_DB_POOL_SIZE "5"
  env_set "$file" STUDIO_DEFAULT_ORGANIZATION "Spark"
  env_set "$file" STUDIO_DEFAULT_PROJECT "Spark Air-Gap"
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
  env_set "$file" PROXY_DOMAIN "$AIRGAP_SERVER_IP"
  env_set "$file" CERTBOT_EMAIL ""
  env_set "$file" PHONE_LOGIN_ALLOWED_ORIGINS "$base"

  env_has_nonempty "$file" SEND_SMS_HOOK_SECRET || env_set "$file" SEND_SMS_HOOK_SECRET "v1,whsec_$(openssl rand -base64 32 | tr -d '\n')"
  env_has_nonempty "$file" PHONE_RATE_LIMIT_PEPPER || env_set "$file" PHONE_RATE_LIMIT_PEPPER "$(openssl rand -hex 32)"
  env_has_nonempty "$file" PHONE_PASSWORD_RESET_SECRET || env_set "$file" PHONE_PASSWORD_RESET_SECRET "$(openssl rand -hex 32)"
  env_has_nonempty "$file" DAILY_REPORT_CRON_SECRET || env_set "$file" DAILY_REPORT_CRON_SECRET "$(openssl rand -hex 32)"
  env_has_nonempty "$file" NOTIFICATION_OUTBOX_CRON_SECRET || env_set "$file" NOTIFICATION_OUTBOX_CRON_SECRET "$(openssl rand -hex 32)"
  env_has_nonempty "$file" MINUTES_REMINDER_CRON_SECRET || env_set "$file" MINUTES_REMINDER_CRON_SECRET "$(openssl rand -hex 32)"
  env_has_nonempty "$file" DECISION_DUE_CRON_SECRET || env_set "$file" DECISION_DUE_CRON_SECRET "$(openssl rand -hex 32)"

  normalize_optional_external_env "$file"
  chmod 600 "$file"
  if run_logged "Validate Supabase internal-IP environment" test_supabase_env; then
    mark_step 6
  else
    unmark_step 6
    return 1
  fi
}

patch_compose() {
  patch_compose_standard || return 1
  COMPOSE_FILE="${SUPABASE_ROOT}/docker-compose.yml" AIRGAP_IP="$AIRGAP_SERVER_IP" python3 - <<'PY'
import os,yaml
from pathlib import Path
p=Path(os.environ['COMPOSE_FILE'])
d=yaml.safe_load(p.read_text(encoding='utf-8'))
s=d['services']
ip=os.environ['AIRGAP_IP']
s['api-gw']['ports']=['127.0.0.1:8000:8000/tcp', f'{ip}:8000:8000/tcp']
p.write_text(yaml.safe_dump(d,sort_keys=False,default_flow_style=False),encoding='utf-8')
PY
}

test_compose_security() {
  local rendered rc=0
  rendered="$(mktemp)"
  (cd "$SUPABASE_ROOT" && docker compose config >"$rendered") || rc=$?
  if (( rc != 0 )); then rm -f "$rendered"; return "$rc"; fi
  AIRGAP_IP="$AIRGAP_SERVER_IP" python3 - "$rendered" <<'PY' || rc=$?
import os,sys,yaml
s=yaml.safe_load(open(sys.argv[1],encoding='utf-8'))['services']
ip=os.environ['AIRGAP_IP']
def ports(name): return s[name].get('ports') or []
def parts(v):
    if isinstance(v,dict): return str(v.get('host_ip','')),str(v.get('published','')),str(v.get('target',''))
    text=str(v); bits=text.rsplit(':',2)
    return tuple(bits) if len(bits)==3 else ('',text,'')
api=[parts(x) for x in ports('api-gw')]
supa=[parts(x) for x in ports('supavisor')]
db=[parts(x) for x in ports('db')]
assert any(h=='127.0.0.1' and p=='8000' for h,p,_ in api), api
assert any(h==ip and p=='8000' for h,p,_ in api), api
assert all(h not in ('0.0.0.0','::','[::]','') for h,_,_ in api), api
assert not db, db
assert any(h=='127.0.0.1' and p=='5433' for h,p,_ in supa), supa
assert any(h=='127.0.0.1' and p=='6543' for h,p,_ in supa), supa
assert 'avatar-worker' in s
PY
  rm -f "$rendered"
  return "$rc"
}

airgap_ip_write_database_access_units() {
  local proxyd="$1"
  cat >/etc/systemd/system/spark-db-access.socket <<EOF_SOCKET
[Unit]
Description=Spark Air-Gap PostgreSQL access on internal IPv4

[Socket]
ListenStream=${AIRGAP_SERVER_IP}:5432
NoDelay=true

[Install]
WantedBy=sockets.target
EOF_SOCKET
  cat >/etc/systemd/system/spark-db-access.service <<EOF_SERVICE
[Unit]
Description=Spark PostgreSQL session proxy to local Supavisor
Requires=docker.service spark-db-access.socket
After=docker.service spark-db-access.socket

[Service]
ExecStart=${proxyd} 127.0.0.1:5433
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
EOF_SERVICE
}

database_external_is_open() {
  systemctl is-active --quiet spark-db-access.socket 2>/dev/null || return 1
  ss -lnt 2>/dev/null | awk -v endpoint="${AIRGAP_SERVER_IP}:5432" '$4==endpoint {found=1} END{exit !found}'
}

airgap_ip_database_login_test() {
  local password username image result
  password="$(env_get "${SUPABASE_ROOT}/.env" POSTGRES_PASSWORD)"
  username="$(database_pooler_username)" || return 1
  image="$(postgres_client_image)" || return 1
  [[ -n "$password" ]] || return 1
  result="$(docker run --rm --network host -e PGPASSWORD="$password" --entrypoint psql "$image" \
    -h "$AIRGAP_SERVER_IP" -p 5432 -U "$username" -d postgres -Atqc 'select 1' 2>>"$CURRENT_LOG" || true)"
  [[ "$result" == "1" ]]
}

airgap_ip_provision_database_access() {
  local proxyd
  proxyd="$(find_systemd_socket_proxyd)" || { fail "systemd-socket-proxyd was not found."; return 1; }
  cleanup_database_access_runtime
  airgap_ip_write_database_access_units "$proxyd"
  systemctl daemon-reload || return 1
  systemctl enable --now spark-db-access.socket || return 1
  database_external_is_open || return 1
  airgap_ip_database_login_test || return 1
}

install_step_10() {
  install_step_10_airgap_base || return 1
  new_log "install-10-airgap-ip-access"
  if run_logged "Expose PostgreSQL session endpoint only on ${AIRGAP_SERVER_IP}:5432" airgap_ip_provision_database_access; then
    run_logged "Validate direct Supabase gateway on ${AIRGAP_SERVER_IP}:8000" \
      curl --noproxy '*' -fsS --connect-timeout 5 "http://${AIRGAP_SERVER_IP}:8000/auth/v1/health" >/dev/null || { unmark_step 10; return 1; }
    mark_step 10
  else
    unmark_step 10
    return 1
  fi
}

install_step_11() {
  title
  new_log "install-11-frontend-internal-ip"
  require_manager_values || return 1
  local anon base
  anon="$(env_get "${SUPABASE_ROOT}/.env" ANON_KEY)"
  [[ -n "$anon" ]] || { fail "ANON_KEY is missing."; return 1; }
  base="$(airgap_ip_base_url)"
  env_set "${SPARK_ROOT}/.env.production" VITE_SUPABASE_URL "$base"
  env_set "${SPARK_ROOT}/.env.production" VITE_SUPABASE_ANON_KEY "$anon"
  chmod 600 "${SPARK_ROOT}/.env.production"
  run_logged "Restore bundled frontend node_modules" bash -c "cd '$SPARK_ROOT' && npm ci" || return 1
  run_logged "Production build for internal-IP origin" bash -c "cd '$SPARK_ROOT' && npm run build" || return 1
  run_logged "Validate frontend build secret hygiene" test_frontend_build_security || return 1
  mkdir -p /var/www/spark
  run_logged "Deploy frontend to /var/www/spark" rsync -a --delete "${SPARK_ROOT}/dist/" /var/www/spark/ || return 1
  run_logged "Set web ownership" chown -R www-data:www-data /var/www/spark || return 1
  if run_logged "Validate frontend artifacts" test_frontend_deploy; then mark_step 11; else unmark_step 11; return 1; fi
}

airgap_ip_write_nginx() {
  local ip="$AIRGAP_SERVER_IP"
  cat >/etc/nginx/sites-available/spark <<EOF_NGINX
server_tokens off;
limit_req_zone \$binary_remote_addr zone=spark_auth_limit:10m rate=10r/s;
map \$http_upgrade \$spark_connection_upgrade {
    default upgrade;
    '' close;
}

# Air-Gap origin: HTTP on the server's internal IPv4 only.
# DNS/public TLS are intentionally outside this server configuration.
server {
    listen ${ip}:80 default_server;
    server_name _;
    root /var/www/spark;
    index index.html;
    client_max_body_size 50m;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=(), display-capture=(self)" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' http://accounts.google.com https://accounts.google.com; style-src 'self' 'unsafe-inline' http://accounts.google.com https://accounts.google.com; img-src 'self' data: blob: http: https:; font-src 'self' data:; connect-src 'self' http://${ip} ws://${ip} http://${ip}:8000 ws://${ip}:8000 http://${ip}:7880 ws://${ip}:7880 http://accounts.google.com https://accounts.google.com http://oauth2.googleapis.com https://oauth2.googleapis.com; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'self' http://accounts.google.com https://accounts.google.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self' http://accounts.google.com https://accounts.google.com; object-src 'none'; manifest-src 'self'" always;

    location ^~ /realtime/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$spark_connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto http;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
    location ^~ /functions/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto http;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
    location ~ ^/auth/v1/(token|signup|recover|otp|verify|resend)$ {
        limit_req zone=spark_auth_limit burst=30 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto http;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
    location ^~ /auth/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto http;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
    location ^~ /rest/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto http;
    }
    location ^~ /storage/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto http;
    }
    location ^~ /graphql/v1 {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto http;
    }
    location ^~ /whip {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto http;
        proxy_read_timeout 3600s;
    }
    location /assets/ { try_files \$uri =404; expires 30d; }
    location = /sw.js { try_files \$uri =404; expires -1; etag on; }
    location = /pwa-bootstrap.js { try_files \$uri =404; expires -1; }
    location / { try_files \$uri \$uri/ /index.html; expires -1; }
}
EOF_NGINX
  ln -sfn /etc/nginx/sites-available/spark /etc/nginx/sites-enabled/spark
  rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/spark-bootstrap /etc/nginx/sites-enabled/spark-livekit
}

airgap_ip_test_nginx() {
  local app_headers api_code
  nginx -t || return 1
  systemctl is-active --quiet nginx || return 1
  ss -lnt | awk -v endpoint="${AIRGAP_SERVER_IP}:80" '$4==endpoint {found=1} END{exit !found}' || return 1
  app_headers="$(curl --noproxy '*' -sSI --connect-timeout 5 "http://${AIRGAP_SERVER_IP}/")" || return 1
  grep -Eqi '^X-Content-Type-Options:[[:space:]]*nosniff' <<<"$app_headers" || return 1
  grep -Eqi '^X-Frame-Options:[[:space:]]*SAMEORIGIN' <<<"$app_headers" || return 1
  grep -Eqi '^Content-Security-Policy:' <<<"$app_headers" || return 1
  api_code="$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 "http://${AIRGAP_SERVER_IP}/auth/v1/health" || true)"
  [[ "$api_code" =~ ^2[0-9][0-9]$ ]]
}

install_step_12() {
  title
  new_log "install-12-nginx-internal-ip"
  require_manager_values || return 1
  airgap_ip_write_nginx || return 1
  run_logged "Nginx syntax" nginx -t || return 1
  run_logged "Reload Nginx" systemctl reload nginx || return 1
  if run_logged "Validate internal-IP web/API origin" airgap_ip_test_nginx; then mark_step 12; else unmark_step 12; return 1; fi
}

install_step_13() {
  title
  new_log "install-13-no-local-tls"
  require_manager_values || return 1
  systemctl disable --now certbot.timer >/dev/null 2>&1 || true
  mark_step 13
  ok "Local DNS/TLS provisioning is intentionally disabled in Air-Gap internal-IP mode."
  info "The bank security/ingress layer can terminate public TLS later without changing the isolated server prerequisite."
}

install_step_14() {
  title
  new_log "install-14-nginx-internal-ip"
  require_manager_values || return 1
  local old=""
  [[ -f /etc/nginx/sites-available/spark ]] && old="$(mktemp)" && cp -a /etc/nginx/sites-available/spark "$old"
  airgap_ip_write_nginx || return 1
  if nginx -t >>"$CURRENT_LOG" 2>&1 && systemctl reload nginx >>"$CURRENT_LOG" 2>&1 && airgap_ip_test_nginx >>"$CURRENT_LOG" 2>&1; then
    [[ -n "$old" ]] && rm -f "$old"
    mark_step 14
    ok "Frontend + Supabase API are available on http://${AIRGAP_SERVER_IP}/."
    return 0
  fi
  restore_previous_nginx_production "$old"
  [[ -n "$old" ]] && rm -f "$old"
  unmark_step 14
  return 1
}

test_turn() {
  systemctl is-active --quiet coturn || return 1
  ss -lntup | grep -Eq ':(3478)\b' || return 1
  turnutils_stunclient "$AIRGAP_SERVER_IP" -p 3478 >/dev/null 2>&1
}

install_step_16() {
  title
  new_log "install-16-turn-internal-ip"
  require_manager_values || return 1
  local turn_env="${CONFIG_DIR}/turn-secret.env" secret
  secret="$(env_get "$turn_env" TURN_SHARED_SECRET)"
  [[ -n "$secret" ]] || secret="$(openssl rand -base64 48 | tr -d '\n')"
  env_set "$turn_env" TURN_DOMAIN "$AIRGAP_SERVER_IP"
  env_set "$turn_env" TURN_SHARED_SECRET "$secret"
  env_set "$turn_env" TURN_URL "turn:${AIRGAP_SERVER_IP}:3478?transport=udp"
  env_set "$turn_env" TURN_TCP_URL "turn:${AIRGAP_SERVER_IP}:3478?transport=tcp"
  env_set "$turn_env" TURNS_URL ""
  chmod 600 "$turn_env"

  cat >/etc/turnserver.conf <<EOF_TURN
listening-port=3478
listening-ip=${AIRGAP_SERVER_IP}
relay-ip=${AIRGAP_SERVER_IP}
external-ip=${AIRGAP_SERVER_IP}
fingerprint
use-auth-secret
static-auth-secret=${secret}
realm=${AIRGAP_SERVER_IP}
server-name=${AIRGAP_SERVER_IP}
min-port=${TURN_MIN_PORT}
max-port=${TURN_MAX_PORT}
no-tls
no-dtls
no-cli
no-loopback-peers
no-multicast-peers
stale-nonce=600
EOF_TURN
  chmod 600 /etc/turnserver.conf
  if grep -q '^TURNSERVER_ENABLED=' /etc/default/coturn 2>/dev/null; then
    sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  else
    printf '\nTURNSERVER_ENABLED=1\n' >>/etc/default/coturn
  fi

  if functions_reference_turn_secret; then
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_DOMAIN "$AIRGAP_SERVER_IP"
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_SHARED_SECRET "$secret"
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_URL "turn:${AIRGAP_SERVER_IP}:3478?transport=udp"
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_TCP_URL "turn:${AIRGAP_SERVER_IP}:3478?transport=tcp"
    env_set "${CONFIG_DIR}/functions-extra.env" TURNS_URL ""
    chmod 600 "${CONFIG_DIR}/functions-extra.env"
    if [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]]; then
      run_logged "Reload Functions for internal-IP TURN env" bash -c "cd '$SUPABASE_ROOT' && docker compose up -d --force-recreate functions" || return 1
    fi
  fi

  run_logged "Enable Coturn on internal IPv4" systemctl enable --now coturn || return 1
  if run_logged "Validate internal TURN/STUN" test_turn; then mark_step 16; else unmark_step 16; return 1; fi
}

test_certbot_hook() {
  ! systemctl is-active --quiet certbot.timer 2>/dev/null
}

install_step_17() {
  title
  new_log "install-17-certbot-disabled-airgap-ip"
  systemctl disable --now certbot.timer >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/certbot.service.d/spark-turn.conf
  systemctl daemon-reload || return 1
  install -d -m 0700 "$CONFIG_DIR"
  printf 'Public DNS/TLS lifecycle is external to the Air-Gap server. Origin mode is HTTP on %s.\n' "$AIRGAP_SERVER_IP" >"${CONFIG_DIR}/airgap-certificate-renewal.txt"
  chmod 0600 "${CONFIG_DIR}/airgap-certificate-renewal.txt"
  if test_certbot_hook; then mark_step 17; else unmark_step 17; return 1; fi
}

airgap_ip_ufw_allow() {
  local port="$1" proto="$2"
  ufw allow in to "$AIRGAP_SERVER_IP" port "$port" proto "$proto"
}

test_firewall() {
  local sockets
  ufw status verbose | grep -q 'Status: active' || return 1
  sockets="$(ss -lntp)" || return 1
  grep -Eq "${AIRGAP_SERVER_IP//./\\.}:8000\\b" <<<"$sockets" || return 1
  grep -Eq "${AIRGAP_SERVER_IP//./\\.}:5432\\b" <<<"$sockets" || return 1
  ! grep -Eq '0\.0\.0\.0:(5432|5433|6543|8000|9000)\b|\[::\]:(5432|5433|6543|8000|9000)\b|\*:((5432)|(5433)|(6543)|(8000)|(9000))\b' <<<"$sockets" || return 1
}

install_step_18() {
  title
  new_log "install-18-firewall-internal-ip"
  require_manager_values || return 1
  if ! confirm_word "This resets UFW. Spark web/API/DB/TURN are allowed only to internal IPv4 ${AIRGAP_SERVER_IP}; SSH remains allowed." "FIREWALL"; then
    warn "Firewall change cancelled."
    return 1
  fi
  run_logged "Reset UFW" ufw --force reset || return 1
  run_logged "Default deny incoming" ufw default deny incoming || return 1
  run_logged "Default allow outgoing" ufw default allow outgoing || return 1
  run_logged "Allow SSH" ufw allow 22/tcp || return 1
  run_logged "Allow internal-IP web" airgap_ip_ufw_allow 80 tcp || return 1
  run_logged "Allow direct Supabase gateway" airgap_ip_ufw_allow 8000 tcp || return 1
  run_logged "Allow PostgreSQL session access" airgap_ip_ufw_allow 5432 tcp || return 1
  run_logged "Allow TURN TCP" airgap_ip_ufw_allow 3478 tcp || return 1
  run_logged "Allow TURN UDP" airgap_ip_ufw_allow 3478 udp || return 1
  run_logged "Allow TURN relay UDP" airgap_ip_ufw_allow "${TURN_MIN_PORT}:${TURN_MAX_PORT}" udp || return 1
  run_logged "Enable UFW" ufw --force enable || return 1
  if run_logged "Validate internal-IP firewall/exposure" test_firewall; then mark_step 18; else unmark_step 18; return 1; fi
}

airgap_full_preflight() {
  local root="$1"
  airgap_validate_bundle_dir "$root" || return 1
  airgap_validate_target_compatibility "$root" || return 1
  airgap_verify_images "$root" || { fail "One or more Docker images have not been imported."; return 1; }
  ok "Air-Gap internal-IP mode does not require DNS, public IP or a TLS certificate pack."
}

# LiveKit: internal IPv4 signaling/media without DNS or local TLS.
AIRGAP_LIVEKIT_OVERRIDE="${LIVEKIT_ROOT}/docker-compose.airgap-ip.yml"

livekit_compose() {
  local -a args=(
    -f "${LIVEKIT_ROOT}/docker-compose.yml"
    -f "${LIVEKIT_ROOT}/docker-compose.spark-cli.yml"
  )
  [[ -f "$AIRGAP_LIVEKIT_OVERRIDE" ]] && args+=( -f "$AIRGAP_LIVEKIT_OVERRIDE" )
  docker compose "${args[@]}" --env-file "$LIVEKIT_ENV" "$@"
}

livekit_observability_compose() {
  livekit_compose --profile observability "$@"
}

airgap_ip_write_livekit_override() {
  cat >"$AIRGAP_LIVEKIT_OVERRIDE" <<EOF_YAML
services:
  livekit:
    environment:
      LIVEKIT_CONFIG: |
        port: 7880
        log_level: info
        rtc:
          tcp_port: 7881
          port_range_start: 50000
          port_range_end: 60000
          use_external_ip: false
          node_ip: ${AIRGAP_SERVER_IP}
          ips:
            includes:
              - ${AIRGAP_SERVER_IP}/32
          stun_servers:
            - ${AIRGAP_SERVER_IP}:443
        redis:
          address: \${LIVEKIT_REDIS_ADDRESS:-127.0.0.1:6379}
        keys:
          \${LIVEKIT_API_KEY}: \${LIVEKIT_API_SECRET}
        prometheus_port: 6789
        turn:
          enabled: true
          udp_port: 443
          allow_restricted_peer_cidrs:
            - ${AIRGAP_SERVER_IP}/32
        ingress:
          rtmp_base_url: rtmp://${AIRGAP_SERVER_IP}:1935/live
          whip_base_url: http://${AIRGAP_SERVER_IP}/whip
        webhook:
          api_key: \${LIVEKIT_API_KEY}
          urls:
            - http://${AIRGAP_SERVER_IP}/functions/v1/livekit-webhook
        room:
          auto_create: false
          empty_timeout: 300
          departure_timeout: 60
          max_participants: 20
  ingress:
    environment:
      LIVEKIT_WS_URL: ws://127.0.0.1:7880
      INGRESS_CONFIG_BODY: |
        ws_url: ws://127.0.0.1:7880
        api_key: \${LIVEKIT_API_KEY}
        api_secret: \${LIVEKIT_API_SECRET}
        redis:
          address: \${LIVEKIT_REDIS_ADDRESS:-127.0.0.1:6379}
        health_port: 9092
        prometheus_port: 6787
        rtmp_port: 1935
        whip_port: 8080
        rtc_config:
          udp_port: 7885
          use_external_ip: false
        log_level: info
EOF_YAML
  chmod 0600 "$AIRGAP_LIVEKIT_OVERRIDE"
}

livekit_test_dns() {
  airgap_ip_is_local "$AIRGAP_SERVER_IP"
}

livekit_sync_function_env() {
  local extra="${CONFIG_DIR}/functions-extra.env"
  touch "$extra"
  chmod 600 "$extra"
  env_set "$extra" LIVEKIT_URL "http://${AIRGAP_SERVER_IP}:7880"
  env_set "$extra" LIVEKIT_WS_URL "ws://${AIRGAP_SERVER_IP}:7880"
  env_set "$extra" LIVEKIT_API_KEY "$(livekit_env_value LIVEKIT_API_KEY)"
  env_set "$extra" LIVEKIT_API_SECRET "$(livekit_env_value LIVEKIT_API_SECRET)"
  env_set "$extra" RECORDING_STORAGE_BUCKET "$(livekit_env_value S3_BUCKET)"
  env_set "$extra" RECORDING_STORAGE_REGION "$(livekit_env_value S3_REGION)"
  env_set "$extra" RECORDING_STORAGE_ACCESS_KEY "$(livekit_env_value S3_ACCESS_KEY)"
  env_set "$extra" RECORDING_STORAGE_SECRET_KEY "$(livekit_env_value S3_SECRET_KEY)"
  env_set "$extra" RECORDING_STORAGE_ENDPOINT "$(livekit_env_value S3_ENDPOINT)"
  chmod 600 "$extra"
}

test_livekit_config() {
  require_file "${LIVEKIT_ROOT}/docker-compose.yml" || return 1
  require_file "${LIVEKIT_ROOT}/docker-compose.spark-cli.yml" || return 1
  require_file "$AIRGAP_LIVEKIT_OVERRIDE" || return 1
  require_file "$LIVEKIT_ENV" || return 1
  livekit_require_env || return 1
  livekit_test_dns || return 1
  [[ "$(livekit_env_value LIVEKIT_DOMAIN)" == "$AIRGAP_SERVER_IP" ]] || return 1
  [[ "$(livekit_env_value LIVEKIT_TURN_DOMAIN)" == "$AIRGAP_SERVER_IP" ]] || return 1
  [[ "$(livekit_env_value LIVEKIT_INGRESS_DOMAIN)" == "$AIRGAP_SERVER_IP" ]] || return 1
  [[ "$(livekit_env_value LIVEKIT_WEBHOOK_URL)" == "http://${AIRGAP_SERVER_IP}/functions/v1/livekit-webhook" ]] || return 1
  [[ "$(livekit_env_value S3_ENDPOINT)" == "http://127.0.0.1:9000" ]] || return 1
  livekit_compose config --quiet >>"$CURRENT_LOG" 2>&1 || return 1
  local extra="${CONFIG_DIR}/functions-extra.env"
  [[ "$(env_get "$extra" LIVEKIT_URL)" == "http://${AIRGAP_SERVER_IP}:7880" ]] || return 1
  [[ "$(env_get "$extra" LIVEKIT_WS_URL)" == "ws://${AIRGAP_SERVER_IP}:7880" ]] || return 1
  [[ "$(env_get "$extra" LIVEKIT_API_KEY)" == "$(livekit_env_value LIVEKIT_API_KEY)" ]] || return 1
  [[ "$(env_get "$extra" LIVEKIT_API_SECRET)" == "$(livekit_env_value LIVEKIT_API_SECRET)" ]] || return 1
}

install_step_19() {
  title
  new_log "install-19-livekit-internal-ip"
  require_manager_values || return 1
  require_file "${SUPABASE_ROOT}/.env" || return 1
  require_file "${CONFIG_DIR}/functions-extra.env" || return 1
  require_dir "$LIVEKIT_SOURCE_DIR" || return 1

  run_logged "Sync LiveKit deployment assets" livekit_sync_assets || return 1
  [[ -f "$LIVEKIT_ENV" ]] || cp "${LIVEKIT_ROOT}/.env.example" "$LIVEKIT_ENV"
  chmod 600 "$LIVEKIT_ENV"
  env_set "$LIVEKIT_ENV" MINIO_IMAGE "minio/minio:RELEASE.2025-04-22T22-12-26Z"
  env_set "$LIVEKIT_ENV" MINIO_MC_IMAGE "minio/mc:RELEASE.2025-08-13T08-35-41Z"
  env_set "$LIVEKIT_ENV" PROMETHEUS_IMAGE "prom/prometheus:v3.14.0"
  env_set "$LIVEKIT_ENV" ALERTMANAGER_IMAGE "prom/alertmanager:v0.34.0"
  env_set "$LIVEKIT_ENV" GRAFANA_IMAGE "grafana/grafana:13.2.0"
  env_set "$LIVEKIT_ENV" LOKI_IMAGE "grafana/loki:3.7.0"
  env_set "$LIVEKIT_ENV" ALLOY_IMAGE "grafana/alloy:v1.19.0"
  env_set "$LIVEKIT_ENV" NODE_EXPORTER_IMAGE "prom/node-exporter:v1.12.1"
  env_set "$LIVEKIT_ENV" BLACKBOX_EXPORTER_IMAGE "prom/blackbox-exporter:v0.28.0"
  env_set "$LIVEKIT_ENV" GRAFANA_ADMIN_USER "admin"
  livekit_ensure_secret GRAFANA_ADMIN_PASSWORD "openssl rand -hex 24"

  env_set "$LIVEKIT_ENV" LIVEKIT_DOMAIN "$AIRGAP_SERVER_IP"
  env_set "$LIVEKIT_ENV" LIVEKIT_TURN_DOMAIN "$AIRGAP_SERVER_IP"
  env_set "$LIVEKIT_ENV" LIVEKIT_INGRESS_DOMAIN "$AIRGAP_SERVER_IP"
  env_set "$LIVEKIT_ENV" LIVEKIT_WEBHOOK_URL "http://${AIRGAP_SERVER_IP}/functions/v1/livekit-webhook"
  [[ -n "$(livekit_env_value LIVEKIT_REDIS_ADDRESS)" ]] || env_set "$LIVEKIT_ENV" LIVEKIT_REDIS_ADDRESS "127.0.0.1:6379"
  livekit_ensure_secret LIVEKIT_API_KEY "printf 'LK%s' \"\$(openssl rand -hex 12)\""
  livekit_ensure_secret LIVEKIT_API_SECRET "openssl rand -hex 32"
  livekit_configure_local_recording_storage || return 1
  chmod 600 "$LIVEKIT_ENV"

  install -d -m 0700 "$LIVEKIT_TURN_CERT_DIR"
  airgap_ip_write_livekit_override || return 1
  livekit_sync_function_env || return 1
  if run_logged "Validate LiveKit internal-IP config" test_livekit_config; then
    mark_step 19
    ok "LiveKit signaling origin: ws://${AIRGAP_SERVER_IP}:7880"
  else
    unmark_step 19
    return 1
  fi
}

livekit_install_certbot_hook() {
  rm -f "$LIVEKIT_RENEW_HOOK"
  return 0
}

livekit_firewall_rules() {
  airgap_ip_ufw_allow 7880 tcp || return 1
  airgap_ip_ufw_allow "$LIVEKIT_ICE_TCP_PORT" tcp || return 1
  airgap_ip_ufw_allow "$LIVEKIT_TURN_UDP_PORT" udp || return 1
  airgap_ip_ufw_allow "${LIVEKIT_RTC_MIN_PORT}:${LIVEKIT_RTC_MAX_PORT}" udp || return 1
  airgap_ip_ufw_allow "$LIVEKIT_RTMP_PORT" tcp || return 1
  airgap_ip_ufw_allow "$LIVEKIT_WHIP_UDP_PORT" udp || return 1
}

livekit_public_tls_probe() {
  local code
  code="$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 "http://${AIRGAP_SERVER_IP}:7880/" || true)"
  [[ "$code" =~ ^[1-5][0-9][0-9]$ && "$code" != "000" ]]
}

livekit_turn_tls_probe() {
  turnutils_stunclient "$AIRGAP_SERVER_IP" -p "$LIVEKIT_TURN_UDP_PORT" >/dev/null 2>&1
}

livekit_internal_api_exposure_probe() {
  local ufw_status
  ufw_status="$(ufw status verbose 2>/dev/null || true)"
  grep -q 'Status: active' <<<"$ufw_status" || return 1
  ss -lnt | grep -Eq "${AIRGAP_SERVER_IP//./\\.}:${LIVEKIT_INTERNAL_API_PORT}\\b|0\.0\.0\.0:${LIVEKIT_INTERNAL_API_PORT}\\b|\[::\]:${LIVEKIT_INTERNAL_API_PORT}\\b" || return 1
  curl --noproxy '*' -fsS --connect-timeout 3 "http://${AIRGAP_SERVER_IP}:${LIVEKIT_INTERNAL_API_PORT}/" >/dev/null || return 1
  ufw status | grep -Eq "${LIVEKIT_INTERNAL_API_PORT}/tcp|${LIVEKIT_INTERNAL_API_PORT}[[:space:]]" || return 1
}

livekit_secret_file_permissions_probe() {
  [[ "$(stat -c '%a' "$LIVEKIT_ENV")" == "600" ]] || return 1
  [[ "$(stat -c '%a' "$AIRGAP_LIVEKIT_OVERRIDE")" == "600" ]] || return 1
}

livekit_configure_speaker_timer_worker() {
  local worker_url="http://${AIRGAP_SERVER_IP}/functions/v1/conference-speaker-timer-enforcer"
  (
    cd "$SUPABASE_ROOT"
    docker compose exec -T db psql -v ON_ERROR_STOP=1 -v worker_url="$worker_url" -U postgres -d postgres <<'SQL'
DO $spark$
BEGIN
  IF to_regprocedure('private.configure_conference_speaker_timer_worker(text)') IS NULL THEN
    RAISE EXCEPTION 'speaker timer worker configuration RPC is missing';
  END IF;
END
$spark$;
SELECT private.configure_conference_speaker_timer_worker(:'worker_url');
SQL
  ) >>"$CURRENT_LOG" 2>&1
}

livekit_configure_phase_worker() {
  local worker_url="http://${AIRGAP_SERVER_IP}/functions/v1/conference-phase-enforcer"
  (
    cd "$SUPABASE_ROOT"
    docker compose exec -T db psql -v ON_ERROR_STOP=1 -v worker_url="$worker_url" -U postgres -d postgres <<'SQL'
DO $spark$
BEGIN
  IF to_regprocedure('private.configure_conference_phase_worker(text)') IS NULL THEN
    RAISE EXCEPTION 'conference phase worker configuration RPC is missing';
  END IF;
END
$spark$;
SELECT private.configure_conference_phase_worker(:'worker_url');
SQL
  ) >>"$CURRENT_LOG" 2>&1
}

test_livekit_full_validation() {
  test_livekit_config || return 1
  if ! livekit_runtime_ready; then
    printf 'LiveKit validation failed: runtime readiness\n' >>"$CURRENT_LOG"
    livekit_report_start_failure
    return 1
  fi
  local sockets
  sockets="$(ss -lntup)" || return 1
  grep -Eq ':7880\b' <<<"$sockets" || return 1
  grep -Eq ':7881\b' <<<"$sockets" || return 1
  grep -Eq ':443\b' <<<"$sockets" || return 1
  grep -Eq ':1935\b' <<<"$sockets" || return 1
  grep -Eq ':7885\b' <<<"$sockets" || return 1
  grep -Eq '127\.0\.0\.1:9000\b' <<<"$sockets" || return 1
  curl -fsS --connect-timeout 3 http://127.0.0.1:9000/minio/health/ready >/dev/null || return 1
  livekit_public_tls_probe "$AIRGAP_SERVER_IP" || return 1
  livekit_turn_tls_probe || return 1
  livekit_api_smoke || return 1
  livekit_configure_speaker_timer_worker || return 1
  livekit_configure_phase_worker || return 1
  local function
  for function in \
    conference-livekit-token conference-host-control conference-recording \
    conference-speaker-timer-control conference-speaker-queue-control conference-speaker-timer-enforcer \
    conference-phase-control conference-phase-enforcer conference-chat-control conference-private-chat-control \
    conference-moderator-chat-control conference-reaction conference-poll-control conference-whiteboard-control \
    conference-presentation-control livekit-webhook; do
    livekit_function_unauthorized_probe "$function" || return 1
  done
  livekit_secret_leak_probe || return 1
  livekit_secret_file_permissions_probe || return 1
  livekit_internal_api_exposure_probe || return 1
  ! systemctl is-active --quiet coturn 2>/dev/null || return 1
  local ufw_status
  ufw_status="$(ufw status 2>/dev/null || true)"
  grep -q 'Status: active' <<<"$ufw_status" || return 1
  grep -Eq '443/udp|443[[:space:]].*UDP' <<<"$ufw_status" || return 1
  grep -Eq '7880/tcp|7880[[:space:]]' <<<"$ufw_status" || return 1
  grep -Eq '7881/tcp|7881[[:space:]]' <<<"$ufw_status" || return 1
  grep -Eq '50000:60000/udp|50000:60000[[:space:]]' <<<"$ufw_status" || return 1
}

livekit_write_observability_targets() {
  local target_file="${LIVEKIT_ROOT}/monitoring/targets/blackbox.json"
  install -d -m 0755 "$(dirname "$target_file")"
  cat >"${LIVEKIT_ROOT}/monitoring/blackbox.yml" <<'EOF_BLACKBOX'
modules:
  http_2xx:
    prober: http
    timeout: 8s
    http:
      method: GET
      preferred_ip_protocol: ip4
      ip_protocol_fallback: false
      follow_redirects: true
      fail_if_ssl: true
      fail_if_not_ssl: false
EOF_BLACKBOX
  cat >"$target_file" <<EOF_TARGETS
[
  {
    "targets": ["http://${AIRGAP_SERVER_IP}/auth/v1/health"],
    "labels": {"probe": "spark-api"}
  },
  {
    "targets": ["http://${AIRGAP_SERVER_IP}:7880/"],
    "labels": {"probe": "livekit-internal-ip"}
  },
  {
    "targets": ["http://127.0.0.1:9092/"],
    "labels": {"probe": "ingress-health"}
  }
]
EOF_TARGETS
  chmod 0644 "${LIVEKIT_ROOT}/monitoring/blackbox.yml" "$target_file"
  python3 -m json.tool "$target_file" >/dev/null
}

airgap_status() {
  title
  new_log "airgap-status-internal-ip"
  local root
  root="$(airgap_current_root 2>/dev/null || true)"
  printf 'Air-Gap mode   : INTERNAL-IP ONLY\n'
  printf 'Server IPv4    : %s\n' "${AIRGAP_SERVER_IP:-NOT CONFIGURED}"
  if [[ -n "${AIRGAP_SERVER_IP:-}" ]]; then
    printf 'Web / API      : http://%s/\n' "$AIRGAP_SERVER_IP"
    printf 'Supabase direct: http://%s:8000/\n' "$AIRGAP_SERVER_IP"
    printf 'PostgreSQL     : %s:5432 (Supavisor session)\n' "$AIRGAP_SERVER_IP"
    printf 'LiveKit        : ws://%s:7880\n' "$AIRGAP_SERVER_IP"
    printf 'TURN           : turn:%s:443?transport=udp (LiveKit embedded after step 20)\n' "$AIRGAP_SERVER_IP"
  fi
  if [[ -z "$root" ]]; then
    printf 'Bundle          : NOT ACTIVE\n'
    return 0
  fi
  printf 'Bundle          : %s\n' "$root"
  printf 'Bundle ID       : %s\n' "$(airgap_meta_from "$root" BUNDLE_ID)"
  printf 'Target          : Ubuntu %s / %s\n' "$(airgap_meta_from "$root" UBUNTU_VERSION)" "$(airgap_meta_from "$root" ARCH)"
  printf 'DNS required    : NO\n'
  printf 'Public IP req.  : NO\n'
  printf 'Local TLS req.  : NO\n'
  printf 'Checksums       : '
  if airgap_validate_checksum_manifest "$root" >/dev/null 2>&1; then printf 'OK\n'; else printf 'FAILED\n'; fi
  if [[ -x "$AIRGAP_REAL_DOCKER" ]]; then
    printf 'Docker images   : '
    if airgap_verify_images "$root"; then printf 'READY\n'; else printf 'INCOMPLETE\n'; fi
  fi
}
