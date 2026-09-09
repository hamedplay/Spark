# External WAF TLS termination support for air-gapped bank deployments.
# Loaded after airgap-runtime.sh so it can safely override only the offline path.

AIRGAP_WAF_CONF="${CONFIG_DIR}/airgap-waf.conf"

# Preserve the standard air-gap implementations before overriding them.
eval "$(declare -f airgap_full_preflight | sed '1s/airgap_full_preflight/airgap_full_preflight_local_tls/')"
eval "$(declare -f install_step_13 | sed '1s/install_step_13/install_step_13_local_tls/')"
eval "$(declare -f install_step_14 | sed '1s/install_step_14/install_step_14_local_tls/')"
eval "$(declare -f install_step_16 | sed '1s/install_step_16/install_step_16_local_tls/')"
eval "$(declare -f install_step_18 | sed '1s/install_step_18/install_step_18_local_tls/')"
eval "$(declare -f airgap_status | sed '1s/airgap_status/airgap_status_local_tls/')"
eval "$(declare -f livekit_test_dns | sed '1s/livekit_test_dns/livekit_test_dns_local_tls/')"
eval "$(declare -f livekit_prepare_nginx_tls | sed '1s/livekit_prepare_nginx_tls/livekit_prepare_nginx_tls_local_tls/')"
eval "$(declare -f livekit_copy_turn_certificate | sed '1s/livekit_copy_turn_certificate/livekit_copy_turn_certificate_local_tls/')"
eval "$(declare -f test_livekit_config | sed '1s/test_livekit_config/test_livekit_config_local_tls/')"
eval "$(declare -f livekit_install_certbot_hook | sed '1s/livekit_install_certbot_hook/livekit_install_certbot_hook_local_tls/')"
eval "$(declare -f livekit_public_tls_probe | sed '1s/livekit_public_tls_probe/livekit_public_tls_probe_local_tls/')"
eval "$(declare -f livekit_turn_tls_probe | sed '1s/livekit_turn_tls_probe/livekit_turn_tls_probe_local_tls/')"

airgap_waf_conf_value() {
  local key="$1"
  [[ -f "$AIRGAP_WAF_CONF" ]] || return 0
  sed -n "s/^${key}=//p" "$AIRGAP_WAF_CONF" | tail -n1
}

airgap_waf_https_probe() {
  local domain="$1" result verify code
  [[ -n "$domain" ]] || return 1
  result="$(curl --noproxy '*' -sS -o /dev/null --connect-timeout 5 --max-time 10 \
    -w '%{ssl_verify_result} %{http_code}' "https://${domain}/" 2>/dev/null || true)"
  verify="${result%% *}"
  code="${result##* }"
  [[ "$verify" == "0" && "$code" =~ ^[1-5][0-9][0-9]$ && "$code" != "000" ]]
}

airgap_waf_persist_external_mode() {
  local reason="${1:-auto-detected}"
  install -d -m 0700 "$CONFIG_DIR"
  cat >"$AIRGAP_WAF_CONF" <<EOF
TLS_MODE=external_waf
TURN_TLS_MODE=disabled
MODE_REASON=${reason}
DETECTED_AT=$(date -Is)
EOF
  chmod 0600 "$AIRGAP_WAF_CONF"
}

airgap_waf_enable_explicit() {
  title
  new_log "airgap-enable-bank-waf"
  require_manager_values || return 1
  airgap_waf_persist_external_mode "operator-selected"
  systemctl disable --now certbot.timer >/dev/null 2>&1 || true

  printf 'Frontend WAF HTTPS : '
  if airgap_waf_https_probe "$APP_DOMAIN"; then printf 'VALID\n'; else printf 'NOT VERIFIED YET\n'; fi
  printf 'API WAF HTTPS      : '
  if airgap_waf_https_probe "$API_DOMAIN"; then printf 'VALID\n'; else printf 'NOT VERIFIED YET\n'; fi

  ok "Bank WAF TLS termination mode is now explicit and persistent."
  info "Steps 13/14 will not request or require local web/API certificates."
  info "Public URLs remain HTTPS; the Spark backend listens on HTTP behind the WAF."
}

airgap_waf_enabled() {
  local mode
  mode="$(airgap_waf_conf_value TLS_MODE)"
  case "$mode" in
    external_waf) return 0 ;;
    local) return 1 ;;
  esac

  # Conservative auto-detection remains as a convenience, but the explicit UI
  # action is authoritative for managed bank deployments where the WAF may not
  # return an application response until the backend has finished installing.
  if cert_live_dir_for_domain "${APP_DOMAIN:-}" >/dev/null 2>&1 \
      && cert_live_dir_for_domain "${API_DOMAIN:-}" >/dev/null 2>&1; then
    return 1
  fi
  if airgap_waf_https_probe "${APP_DOMAIN:-}" && airgap_waf_https_probe "${API_DOMAIN:-}"; then
    airgap_waf_persist_external_mode "auto-detected"
    info "Detected valid external HTTPS termination for ${APP_DOMAIN} and ${API_DOMAIN}; using Bank WAF TLS mode."
    return 0
  fi
  return 1
}

airgap_full_preflight() {
  local root="$1"
  if ! airgap_waf_enabled; then
    airgap_full_preflight_local_tls "$root"
    return
  fi
  airgap_validate_bundle_dir "$root" || return 1
  airgap_validate_target_compatibility "$root" || return 1
  airgap_verify_images "$root" || { fail "One or more Docker images have not been imported."; return 1; }
  ok "External Bank WAF terminates HTTPS; local certificate-pack requirement is disabled for web/API."
}

install_step_13() {
  if ! airgap_waf_enabled; then
    install_step_13_local_tls "$@"
    return
  fi
  title
  new_log "install-13-external-waf"
  require_manager_values || return 1
  systemctl disable --now certbot.timer >/dev/null 2>&1 || true
  mark_step 13
  ok "TLS is terminated by the Bank WAF; no local frontend/API certificate is installed."
}

airgap_waf_write_nginx_production() {
  cat >/etc/nginx/sites-available/spark <<EOF
server_tokens off;

limit_req_zone \$binary_remote_addr zone=spark_auth_limit:10m rate=10r/s;

map \$http_upgrade \$spark_connection_upgrade {
    default upgrade;
    '' close;
}

# Bank WAF terminates HTTPS and forwards plain HTTP to this backend.
server {
    listen 80;
    server_name ${APP_DOMAIN} ${WWW_DOMAIN};

    root /var/www/spark;
    index index.html;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=(), display-capture=(self)" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://accounts.google.com; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://${API_DOMAIN} wss://${API_DOMAIN} https://meet.${APP_DOMAIN} wss://meet.${APP_DOMAIN} https://accounts.google.com https://oauth2.googleapis.com; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'self' https://accounts.google.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self' https://accounts.google.com; object-src 'none'; manifest-src 'self'; upgrade-insecure-requests" always;

    location /assets/ { try_files \$uri =404; expires 30d; }
    location = /sw.js { try_files \$uri =404; expires -1; etag on; }
    location = /pwa-bootstrap.js { try_files \$uri =404; expires -1; }
    location / { try_files \$uri \$uri/ /index.html; expires -1; }
}

server {
    listen 80;
    server_name ${API_DOMAIN};
    client_max_body_size 50m;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;

    location ^~ /realtime/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$spark_connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }

    location ^~ /functions/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    location ~ ^/auth/v1/(token|signup|recover|otp|verify|resend)$ {
        limit_req zone=spark_auth_limit burst=30 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    location /auth/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    location ^~ /rest/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
    }
    location ^~ /storage/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
    }
    location ^~ /graphql/v1 {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
    }
    location / { return 404; }
}

server {
    listen 80;
    server_name ${TURN_DOMAIN};
    location / { return 404; }
}
EOF
  ln -sfn /etc/nginx/sites-available/spark /etc/nginx/sites-enabled/spark
  rm -f /etc/nginx/sites-enabled/spark-bootstrap
}

airgap_waf_test_nginx() {
  local app_headers api_headers
  nginx -t || return 1
  systemctl is-active --quiet nginx || return 1
  [[ -L /etc/nginx/sites-enabled/spark ]] || return 1
  app_headers="$(curl --noproxy '*' -sSI --connect-timeout 5 --max-time 10 -H "Host: ${APP_DOMAIN}" http://127.0.0.1/)" || return 1
  grep -Eqi '^X-Content-Type-Options:[[:space:]]*nosniff' <<<"$app_headers" || return 1
  grep -Eqi '^X-Frame-Options:[[:space:]]*SAMEORIGIN' <<<"$app_headers" || return 1
  grep -Eqi '^Content-Security-Policy:' <<<"$app_headers" || return 1
  api_headers="$(curl --noproxy '*' -sSI --connect-timeout 5 --max-time 10 -H "Host: ${API_DOMAIN}" http://127.0.0.1/ || true)"
  grep -Eqi '^X-Content-Type-Options:[[:space:]]*nosniff' <<<"$api_headers" || return 1
}

install_step_14() {
  if ! airgap_waf_enabled; then
    install_step_14_local_tls "$@"
    return
  fi
  title
  new_log "install-14-external-waf-nginx"
  require_manager_values || return 1
  local old=""
  [[ -f /etc/nginx/sites-available/spark ]] && old="$(mktemp)" && cp -a /etc/nginx/sites-available/spark "$old"
  airgap_waf_write_nginx_production || return 1
  if nginx -t >>"$CURRENT_LOG" 2>&1 && systemctl reload nginx >>"$CURRENT_LOG" 2>&1 && airgap_waf_test_nginx >>"$CURRENT_LOG" 2>&1; then
    [[ -n "$old" ]] && rm -f "$old"
    mark_step 14
    ok "Nginx backend is ready behind external Bank WAF TLS termination."
    return 0
  fi
  restore_previous_nginx_production "$old"
  [[ -n "$old" ]] && rm -f "$old"
  unmark_step 14
  fail "External-WAF Nginx backend validation failed."
  return 1
}

install_step_16() {
  if ! airgap_waf_enabled; then
    install_step_16_local_tls "$@"
    return
  fi
  title
  new_log "install-16-turn-no-tls"
  require_manager_values || return 1
  local turn_env="${CONFIG_DIR}/turn-secret.env" secret external_line
  secret="$(env_get "$turn_env" TURN_SHARED_SECRET)"
  [[ -n "$secret" ]] || secret="$(openssl rand -base64 48 | tr -d '\n')"
  env_set "$turn_env" TURN_DOMAIN "$TURN_DOMAIN"
  env_set "$turn_env" TURN_SHARED_SECRET "$secret"
  env_set "$turn_env" TURN_URL "turn:${TURN_DOMAIN}:3478?transport=udp"
  env_set "$turn_env" TURN_TCP_URL "turn:${TURN_DOMAIN}:3478?transport=tcp"
  env_set "$turn_env" TURNS_URL ""
  chmod 600 "$turn_env"

  if [[ "$TURN_PUBLIC_IP" == "$TURN_PRIVATE_IP" ]]; then external_line="external-ip=${TURN_PUBLIC_IP}"; else external_line="external-ip=${TURN_PUBLIC_IP}/${TURN_PRIVATE_IP}"; fi
  cat >/etc/turnserver.conf <<EOF
listening-port=3478
listening-ip=${TURN_PRIVATE_IP}
relay-ip=${TURN_PRIVATE_IP}
${external_line}
fingerprint
use-auth-secret
static-auth-secret=${secret}
realm=${TURN_DOMAIN}
server-name=${TURN_DOMAIN}
min-port=${TURN_MIN_PORT}
max-port=${TURN_MAX_PORT}
no-tls
no-dtls
no-cli
no-loopback-peers
no-multicast-peers
stale-nonce=600
EOF
  chmod 600 /etc/turnserver.conf
  if grep -q '^TURNSERVER_ENABLED=' /etc/default/coturn 2>/dev/null; then sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn; else printf '\nTURNSERVER_ENABLED=1\n' >>/etc/default/coturn; fi

  if functions_reference_turn_secret; then
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_DOMAIN "$TURN_DOMAIN"
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_SHARED_SECRET "$secret"
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_URL "turn:${TURN_DOMAIN}:3478?transport=udp"
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_TCP_URL "turn:${TURN_DOMAIN}:3478?transport=tcp"
    env_set "${CONFIG_DIR}/functions-extra.env" TURNS_URL ""
    chmod 600 "${CONFIG_DIR}/functions-extra.env"
    if [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]]; then
      run_logged "Reload Functions for TURN env" bash -c "cd '$SUPABASE_ROOT' && docker compose up -d --force-recreate functions" || return 1
    fi
  fi

  run_logged "Enable Coturn without local TLS" systemctl enable --now coturn || return 1
  if run_logged "Validate TURN/STUN on 3478" test_turn; then mark_step 16; else unmark_step 16; return 1; fi
}

install_step_18() {
  if ! airgap_waf_enabled; then
    install_step_18_local_tls "$@"
    return
  fi
  install_step_18_local_tls "$@" || return 1
  ufw delete allow 5349/tcp >/dev/null 2>&1 || true
  ok "Unused local TURNS/5349 rule removed; external WAF mode uses TURN UDP/TCP without local TLS."
}

airgap_waf_domain_resolves() {
  local domain="$1"
  getent ahostsv4 "$domain" 2>>"$CURRENT_LOG" | awk '{print $1}' | grep -q .
}

livekit_test_dns() {
  if ! airgap_waf_enabled; then
    livekit_test_dns_local_tls "$@"
    return
  fi
  local meet ingress turn
  meet="$(livekit_env_value LIVEKIT_DOMAIN)"
  ingress="$(livekit_env_value LIVEKIT_INGRESS_DOMAIN)"
  turn="$(livekit_env_value LIVEKIT_TURN_DOMAIN)"
  airgap_waf_domain_resolves "$meet" || { echo "External WAF hostname does not resolve: $meet" >>"$CURRENT_LOG"; return 1; }
  airgap_waf_domain_resolves "$ingress" || { echo "External WAF hostname does not resolve: $ingress" >>"$CURRENT_LOG"; return 1; }
  livekit_domain_resolves_to_public_ip "$turn" || { echo "TURN must resolve directly to TURN_PUBLIC_IP in WAF mode: $turn" >>"$CURRENT_LOG"; return 1; }
}

airgap_waf_write_livekit_nginx() {
  local meet ingress
  meet="$(livekit_env_value LIVEKIT_DOMAIN)"
  ingress="$(livekit_env_value LIVEKIT_INGRESS_DOMAIN)"
  cat >/etc/nginx/sites-available/spark-livekit <<EOF
server {
    listen 80;
    server_name ${meet};
    location / {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
server {
    listen 80;
    server_name ${ingress};
    client_max_body_size 0;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
EOF
  ln -sfn /etc/nginx/sites-available/spark-livekit /etc/nginx/sites-enabled/spark-livekit
  livekit_patch_frontend_csp
}

livekit_prepare_nginx_tls() {
  if ! airgap_waf_enabled; then
    livekit_prepare_nginx_tls_local_tls "$@"
    return
  fi
  airgap_waf_write_livekit_nginx || return 1
  nginx -t || return 1
  systemctl reload nginx || return 1
}

airgap_waf_disable_livekit_turn_tls() {
  COMPOSE_FILE="${LIVEKIT_ROOT}/docker-compose.yml" python3 - <<'PY'
import os, yaml
from pathlib import Path
p=Path(os.environ['COMPOSE_FILE'])
d=yaml.safe_load(p.read_text(encoding='utf-8')) or {}
svc=(d.get('services') or {}).get('livekit')
if not isinstance(svc, dict): raise SystemExit('livekit service missing')
env=svc.get('environment') or {}
body=env.get('LIVEKIT_CONFIG')
if not isinstance(body, str): raise SystemExit('LIVEKIT_CONFIG missing')
cfg=yaml.safe_load(body) or {}
turn=cfg.setdefault('turn', {})
turn['enabled']=True
turn['udp_port']=443
for key in ('tls_port','cert_file','key_file'):
    turn.pop(key, None)
env['LIVEKIT_CONFIG']=yaml.safe_dump(cfg, sort_keys=False)
svc['environment']=env
vols=svc.get('volumes') or []
svc['volumes']=[v for v in vols if '/etc/livekit/turn-cert' not in str(v)]
p.write_text(yaml.safe_dump(d, sort_keys=False), encoding='utf-8')
PY
}

livekit_copy_turn_certificate() {
  if ! airgap_waf_enabled; then
    livekit_copy_turn_certificate_local_tls "$@"
    return
  fi
  rm -rf "$LIVEKIT_TURN_CERT_DIR"
  airgap_waf_disable_livekit_turn_tls
}

test_livekit_config() {
  if ! airgap_waf_enabled; then
    test_livekit_config_local_tls "$@"
    return
  fi
  require_file "${LIVEKIT_ROOT}/docker-compose.yml" || return 1
  require_file "${LIVEKIT_ROOT}/docker-compose.spark-cli.yml" || return 1
  require_file "$LIVEKIT_ENV" || return 1
  livekit_require_env || return 1
  livekit_test_dns || return 1
  [[ "$(livekit_env_value S3_ENDPOINT)" == "http://127.0.0.1:9000" ]] || return 1
  livekit_compose config --quiet >>"$CURRENT_LOG" 2>&1 || return 1
  python3 - "${LIVEKIT_ROOT}/docker-compose.yml" <<'PY' || return 1
import sys,yaml
from pathlib import Path
d=yaml.safe_load(Path(sys.argv[1]).read_text()) or {}
body=((d.get('services') or {}).get('livekit') or {}).get('environment',{}).get('LIVEKIT_CONFIG','')
cfg=yaml.safe_load(body) or {}
turn=cfg.get('turn') or {}
if any(k in turn for k in ('tls_port','cert_file','key_file')): raise SystemExit(1)
if turn.get('udp_port') != 443: raise SystemExit(1)
PY
  local extra="${CONFIG_DIR}/functions-extra.env"
  [[ "$(env_get "$extra" LIVEKIT_URL)" == "https://$(livekit_env_value LIVEKIT_DOMAIN)" ]] || return 1
  [[ "$(env_get "$extra" LIVEKIT_WS_URL)" == "wss://$(livekit_env_value LIVEKIT_DOMAIN)" ]] || return 1
  [[ "$(env_get "$extra" LIVEKIT_API_KEY)" == "$(livekit_env_value LIVEKIT_API_KEY)" ]] || return 1
  [[ "$(env_get "$extra" LIVEKIT_API_SECRET)" == "$(livekit_env_value LIVEKIT_API_SECRET)" ]] || return 1
}

livekit_install_certbot_hook() {
  if ! airgap_waf_enabled; then
    livekit_install_certbot_hook_local_tls "$@"
    return
  fi
  install -d -m 0700 "$CONFIG_DIR"
  printf 'LiveKit HTTPS is terminated by the Bank WAF; no local Certbot hook is installed.\n' >"${CONFIG_DIR}/livekit-external-waf-tls.txt"
  chmod 0600 "${CONFIG_DIR}/livekit-external-waf-tls.txt"
}

livekit_public_tls_probe() {
  if ! airgap_waf_enabled; then
    livekit_public_tls_probe_local_tls "$@"
    return
  fi
  airgap_waf_https_probe "$1"
}

livekit_turn_tls_probe() {
  if ! airgap_waf_enabled; then
    livekit_turn_tls_probe_local_tls "$@"
    return
  fi
  ss -lun | awk '{print $5}' | grep -Eq '(^|:)443$'
}

airgap_status() {
  airgap_status_local_tls
  printf 'TLS termination : %s\n' "$(airgap_waf_enabled >/dev/null 2>&1 && echo 'EXTERNAL BANK WAF' || echo 'LOCAL')"
  if airgap_waf_enabled >/dev/null 2>&1; then
    printf 'TURN TLS        : DISABLED (TURN UDP/TCP remains enabled)\n'
  fi
}
