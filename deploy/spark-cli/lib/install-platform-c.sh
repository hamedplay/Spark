functions_reference_turn_secret() {
  grep -Rqs --include='*.ts' --include='*.js' 'TURN_SHARED_SECRET' "${SPARK_ROOT}/supabase/functions"
}

test_turn() {
  systemctl is-active --quiet coturn || return 1
  ss -lntup | grep -Eq ':(3478|5349)\b' || return 1
  turnutils_stunclient "$TURN_DOMAIN" -p 3478 || return 1
}

install_step_18() {
  title
  new_log "install-18-turn"
  require_manager_values || return 1
  require_file "/etc/letsencrypt/live/${TURN_DOMAIN}/fullchain.pem" || return 1
  require_file "/etc/letsencrypt/live/${TURN_DOMAIN}/privkey.pem" || return 1
  mkdir -p /etc/coturn/certs
  chown turnserver:turnserver /etc/coturn/certs
  chmod 750 /etc/coturn/certs
  install -m 0640 -o turnserver -g turnserver "/etc/letsencrypt/live/${TURN_DOMAIN}/fullchain.pem" /etc/coturn/certs/fullchain.pem
  install -m 0640 -o turnserver -g turnserver "/etc/letsencrypt/live/${TURN_DOMAIN}/privkey.pem" /etc/coturn/certs/privkey.pem

  local turn_env="${CONFIG_DIR}/turn-secret.env" secret
  secret="$(env_get "$turn_env" TURN_SHARED_SECRET)"
  [[ -n "$secret" ]] || secret="$(openssl rand -base64 48 | tr -d '\n')"
  env_set "$turn_env" TURN_DOMAIN "$TURN_DOMAIN"
  env_set "$turn_env" TURN_SHARED_SECRET "$secret"
  env_set "$turn_env" TURN_URL "turn:${TURN_DOMAIN}:3478?transport=udp"
  env_set "$turn_env" TURN_TCP_URL "turn:${TURN_DOMAIN}:3478?transport=tcp"
  env_set "$turn_env" TURNS_URL "turns:${TURN_DOMAIN}:5349?transport=tcp"
  chmod 600 "$turn_env"

  local external_line
  if [[ "$TURN_PUBLIC_IP" == "$TURN_PRIVATE_IP" ]]; then
    external_line="external-ip=${TURN_PUBLIC_IP}"
  else
    external_line="external-ip=${TURN_PUBLIC_IP}/${TURN_PRIVATE_IP}"
  fi
  cat >/etc/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
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

cert=/etc/coturn/certs/fullchain.pem
pkey=/etc/coturn/certs/privkey.pem

no-cli
no-loopback-peers
no-multicast-peers
stale-nonce=600
no-tlsv1
no-tlsv1_1
EOF
  chmod 600 /etc/turnserver.conf
  if grep -q '^TURNSERVER_ENABLED=' /etc/default/coturn 2>/dev/null; then
    sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  else
    printf '\nTURNSERVER_ENABLED=1\n' >>/etc/default/coturn
  fi

  if functions_reference_turn_secret; then
    info "Source فعلی TURN_SHARED_SECRET را مصرف می‌کند؛ همان Secret به functions-extra.env اضافه می‌شود."
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_DOMAIN "$TURN_DOMAIN"
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_SHARED_SECRET "$secret"
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_URL "turn:${TURN_DOMAIN}:3478?transport=udp"
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_TCP_URL "turn:${TURN_DOMAIN}:3478?transport=tcp"
    env_set "${CONFIG_DIR}/functions-extra.env" TURNS_URL "turns:${TURN_DOMAIN}:5349?transport=tcp"
    chmod 600 "${CONFIG_DIR}/functions-extra.env"
    if [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]]; then
      run_logged "Reload Functions برای TURN env" bash -c "cd '$SUPABASE_ROOT' && docker compose up -d --force-recreate functions" || return 1
    fi
  fi

  run_logged "فعال‌سازی coturn" systemctl enable --now coturn || return 1
  if run_logged "تست TURN/STUN" test_turn; then
    mark_step 18
  else
    unmark_step 18
    return 1
  fi
}

test_certbot_hook() {
  systemctl is-enabled --quiet certbot.timer || return 1
  systemctl is-active --quiet certbot.timer || return 1
  require_file /etc/systemd/system/certbot.service.d/spark-turn.conf || return 1
}

install_step_19() {
  title
  new_log "install-19-certbot-renewal"
  require_manager_values || return 1
  mkdir -p /etc/systemd/system/certbot.service.d
  cat >/etc/systemd/system/certbot.service.d/spark-turn.conf <<EOF
[Service]
ExecStartPost=/usr/bin/install -m 0640 -o turnserver -g turnserver /etc/letsencrypt/live/${TURN_DOMAIN}/fullchain.pem /etc/coturn/certs/fullchain.pem
ExecStartPost=/usr/bin/install -m 0640 -o turnserver -g turnserver /etc/letsencrypt/live/${TURN_DOMAIN}/privkey.pem /etc/coturn/certs/privkey.pem
ExecStartPost=/usr/bin/systemctl try-restart coturn.service
EOF
  run_logged "systemd daemon-reload" systemctl daemon-reload || return 1
  run_logged "فعال‌سازی certbot.timer" systemctl enable --now certbot.timer || return 1
  run_visible "Certbot renewal dry-run" certbot renew --dry-run || return 1
  if run_logged "تست Certbot hook/timer" test_certbot_hook; then
    mark_step 19
  else
    unmark_step 19
    return 1
  fi
}

ssh_client_in_admin_cidr() {
  local client="${SSH_CONNECTION%% *}"
  [[ -z "$client" || "$client" == "$SSH_CONNECTION" ]] && return 0
  python3 - "$client" "$ADMIN_CIDR" <<'PY'
import ipaddress,sys
try:
    raise SystemExit(0 if ipaddress.ip_address(sys.argv[1]) in ipaddress.ip_network(sys.argv[2],strict=False) else 1)
except ValueError:
    raise SystemExit(1)
PY
}

test_firewall() {
  ufw status verbose || return 1
  ufw status | grep -q "Status: active" || return 1
  ! ss -lntp | grep -Eq '0\.0\.0\.0:(5432|5433|6543|8000|9000)\b|\[::\]:(5432|5433|6543|8000|9000)\b' || return 1
}

install_step_20() {
  title
  new_log "install-20-firewall"
  require_manager_values || return 1
  if [[ -n "${SSH_CONNECTION:-}" ]] && ! ssh_client_in_admin_cidr; then
    fail "IP فعلی SSH داخل ADMIN_CIDR=${ADMIN_CIDR} نیست. برای جلوگیری از lockout عملیات متوقف شد."
    printf 'SSH_CONNECTION=%s\n' "$SSH_CONNECTION" >>"$CURRENT_LOG"
    return 1
  fi
  if ! confirm_word "این مرحله UFW را reset می‌کند و فقط SSH از ${ADMIN_CIDR} را مجاز می‌گذارد." "FIREWALL"; then
    warn "تغییر Firewall لغو شد."
    return 1
  fi
  run_logged "Reset UFW" ufw --force reset || return 1
  run_logged "Default deny incoming" ufw default deny incoming || return 1
  run_logged "Default allow outgoing" ufw default allow outgoing || return 1
  run_logged "Allow SSH from ADMIN_CIDR" ufw allow from "$ADMIN_CIDR" to any port 22 proto tcp || return 1
  run_logged "Allow HTTP" ufw allow 80/tcp || return 1
  run_logged "Allow HTTPS" ufw allow 443/tcp || return 1
  run_logged "Allow TURN TCP" ufw allow 3478/tcp || return 1
  run_logged "Allow TURN UDP" ufw allow 3478/udp || return 1
  run_logged "Allow TURNS TCP" ufw allow 5349/tcp || return 1
  run_logged "Allow TURN relay UDP" ufw allow "${TURN_MIN_PORT}:${TURN_MAX_PORT}/udp" || return 1
  run_logged "Enable UFW" ufw --force enable || return 1
  if run_logged "تست Firewall و عدم exposure داخلی" test_firewall; then
    mark_step 20
  else
    unmark_step 20
    return 1
  fi
}

run_install_step() {
  local n="$1"
  "install_step_${n}"
}

run_all_install() {
  local n
  for n in $(seq 1 20); do
    if ! run_install_step "$n"; then
      fail "اجرای زنجیره‌ای در مرحله ${n} متوقف شد."
      return 1
    fi
  done
  ok "تمام مراحل 1 تا 20 با موفقیت اجرا شدند."
}

install_menu() {
  while true; do
    title
    printf '%sمنوی نصب Single Host — مطابق single-host.md%s\n\n' "$C_BOLD" "$C_RESET"
    printf '  0) بازگشت\n'
    printf '  1) %s DNS\n' "$(step_badge 1)"
    printf '  2) %s مقادیر نصب و Configuration\n' "$(step_badge 2)"
    printf '  3) %s Packageهای پایه + Docker + Node 24\n' "$(step_badge 3)"
    printf '  4) %s دریافت Spark\n' "$(step_badge 4)"
    printf '  5) %s دریافت Supabase pin شده\n' "$(step_badge 5)"
    printf '  6) %s تولید Secretهای Supabase\n' "$(step_badge 6)"
    printf '  7) %s تکمیل Supabase .env\n' "$(step_badge 7)"
    printf '  8) %s Sync Edge Functions + Main Router\n' "$(step_badge 8)"
    printf '  9) %s Provider / Worker Environment\n' "$(step_badge 9)"
    printf ' 10) %s Docker Compose hardening/config\n' "$(step_badge 10)"
    printf ' 11) %s Validate و Start Supabase\n' "$(step_badge 11)"
    printf ' 12) %s اعمال Migrationهای Spark\n' "$(step_badge 12)"
    printf ' 13) %s Build و Deploy Frontend\n' "$(step_badge 13)"
    printf ' 14) %s Nginx Bootstrap\n' "$(step_badge 14)"
    printf ' 15) %s Certificateها\n' "$(step_badge 15)"
    printf ' 16) %s Nginx Production\n' "$(step_badge 16)"
    printf ' 17) %s Schedulerهای Local\n' "$(step_badge 17)"
    printf ' 18) %s TURN/Coturn\n' "$(step_badge 18)"
    printf ' 19) %s Certbot Renewal Hook\n' "$(step_badge 19)"
    printf ' 20) %s Firewall\n' "$(step_badge 20)"
    printf ' 21) اجرای مراحل 1 تا 20 به‌ترتیب\n\n'
    read -r -p "انتخاب: " choice
    case "$choice" in
      0) return ;;
      [1-9]|1[0-9]|20) run_install_step "$choice" || true; pause ;;
      21) run_all_install || true; pause ;;
      *) fail "گزینه نامعتبر"; sleep 1 ;;
    esac
  done
}
