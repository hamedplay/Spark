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

test_firewall() {
  local sockets db_public=0 db_managed=0
  ufw status verbose || return 1
  ufw status | grep -q "Status: active" || return 1
  sockets="$(ss -lntp)" || return 1

  if grep -Eq '0\.0\.0\.0:(5433|6543|8000|9000)\b|\[::\]:(5433|6543|8000|9000)\b' <<<"$sockets"; then
    return 1
  fi

  grep -Eq '0\.0\.0\.0:5432\b|\[::\]:5432\b|\*:5432\b' <<<"$sockets" && db_public=1
  systemctl is-active --quiet spark-db-access.socket 2>/dev/null && db_managed=1
  if (( db_public && ! db_managed )); then
    return 1
  fi
}

install_step_20() {
  title
  new_log "install-20-firewall"
  require_manager_values || return 1
  local db_was_open=0 studio_was_open=0
  database_external_is_open 2>/dev/null && db_was_open=1
  studio_external_is_open 2>/dev/null && studio_was_open=1

  if ! confirm_word "این مرحله UFW را reset می‌کند؛ SSH/HTTP/HTTPS/TURN باز می‌مانند و وضعیت فعلی Database 5432 / Studio 8443 حفظ می‌شود." "FIREWALL"; then
    warn "تغییر Firewall لغو شد."
    return 1
  fi
  run_logged "Reset UFW" ufw --force reset || return 1
  run_logged "Default deny incoming" ufw default deny incoming || return 1
  run_logged "Default allow outgoing" ufw default allow outgoing || return 1
  run_logged "Allow SSH" ufw allow 22/tcp || return 1
  run_logged "Allow HTTP" ufw allow 80/tcp || return 1
  run_logged "Allow HTTPS" ufw allow 443/tcp || return 1
  run_logged "Allow TURN TCP" ufw allow 3478/tcp || return 1
  run_logged "Allow TURN UDP" ufw allow 3478/udp || return 1
  run_logged "Allow TURNS TCP" ufw allow 5349/tcp || return 1
  run_logged "Allow TURN relay UDP" ufw allow "${TURN_MIN_PORT}:${TURN_MAX_PORT}/udp" || return 1
  if (( db_was_open )); then
    run_logged "Preserve Database TCP/5432 access" ufw allow 5432/tcp || return 1
  fi
  if (( studio_was_open )); then
    run_logged "Preserve Supabase Studio TCP/8443 access" ufw allow 8443/tcp || return 1
  fi
  run_logged "Enable UFW" ufw --force enable || return 1
  if run_logged "تست Firewall و exposure مدیریت‌شده" test_firewall; then
    mark_step 20
  else
    unmark_step 20
    return 1
  fi
}

# Logical installer numbering: 01..18. Internal legacy function numbers stay intact.
install_legacy_to_logical() {
  case "$1" in
    2) echo 1 ;; 3) echo 2 ;; 4) echo 3 ;; 5) echo 4 ;; 6) echo 5 ;; 7) echo 6 ;;
    8) echo 7 ;; 9) echo 8 ;; 10) echo 9 ;; 11) echo 10 ;; 13) echo 11 ;; 14) echo 12 ;;
    15) echo 13 ;; 16) echo 14 ;; 17) echo 15 ;; 18) echo 16 ;; 19) echo 17 ;; 20) echo 18 ;;
    *) return 1 ;;
  esac
}

install_logical_to_legacy() {
  case "$1" in
    1) echo 2 ;; 2) echo 3 ;; 3) echo 4 ;; 4) echo 5 ;; 5) echo 6 ;; 6) echo 7 ;;
    7) echo 8 ;; 8) echo 9 ;; 9) echo 10 ;; 10) echo 11 ;; 11) echo 13 ;; 12) echo 14 ;;
    13) echo 15 ;; 14) echo 16 ;; 15) echo 17 ;; 16) echo 18 ;; 17) echo 19 ;; 18) echo 20 ;;
    *) return 1 ;;
  esac
}

ensure_logical_install_history() {
  local version_file="${STEP_DIR}/.layout-version"
  local expected="logical-01-18-v1"
  if [[ ! -f "$version_file" || "$(cat "$version_file" 2>/dev/null || true)" != "$expected" ]]; then
    rm -f "${STEP_DIR}"/*.ok
    printf '%s\n' "$expected" >"$version_file"
    chmod 600 "$version_file"
  fi
}

mark_step() {
  local logical
  logical="$(install_legacy_to_logical "$1")" || return 1
  ensure_logical_install_history
  printf '%s\n' "$(date -Is)" >"${STEP_DIR}/${logical}.ok"
  chmod 600 "${STEP_DIR}/${logical}.ok"
}

unmark_step() {
  local logical
  logical="$(install_legacy_to_logical "$1")" || return 1
  ensure_logical_install_history
  rm -f "${STEP_DIR}/${logical}.ok"
}

step_badge() {
  local logical
  logical="$(install_legacy_to_logical "$1" 2>/dev/null || printf '%s' "$1")"
  ensure_logical_install_history
  if [[ -f "${STEP_DIR}/${logical}.ok" ]]; then
    printf '%s[✓]%s' "$C_GREEN" "$C_RESET"
  else
    printf '[ ]'
  fi
}

installation_step_name() {
  case "$1" in
    1) printf 'Configuration' ;;
    2) printf 'Base packages / Docker / Node' ;;
    3) printf 'Spark repository' ;;
    4) printf 'Latest Supabase source' ;;
    5) printf 'Supabase secrets' ;;
    6) printf 'Supabase environment' ;;
    7) printf 'Edge Functions sync' ;;
    8) printf 'Provider / worker environment' ;;
    9) printf 'Docker Compose' ;;
    10) printf 'Supabase runtime' ;;
    11) printf 'Frontend deployment' ;;
    12) printf 'Nginx bootstrap / web server' ;;
    13) printf 'TLS certificates' ;;
    14) printf 'Production Nginx' ;;
    15) printf 'Schedulers' ;;
    16) printf 'TURN / Coturn' ;;
    17) printf 'Certbot renewal' ;;
    18) printf 'Firewall / UFW' ;;
    *) return 1 ;;
  esac
}

installation_step_probe() {
  case "$1" in
    1) test_values ;;
    2) test_base_packages ;;
    3) test_spark_repo ;;
    4) test_supabase_source ;;
    5) test_supabase_secrets ;;
    6) test_supabase_env ;;
    7) test_function_sync ;;
    8) test_provider_env ;;
    9) test_compose_security ;;
    10) test_supabase_health ;;
    11) test_frontend_deploy ;;
    12) installation_nginx_present ;;
    13) test_certificates ;;
    14) test_nginx_production ;;
    15) test_schedulers ;;
    16) test_turn ;;
    17) test_certbot_hook ;;
    18) test_firewall ;;
    *) return 1 ;;
  esac
}

installation_status_report() {
  local n name actual history formatted
  local installed=() missing=()
  ensure_logical_install_history
  [[ -n "${CURRENT_LOG:-}" ]] || new_log "installation-status"

  printf 'Spark installation status — actual server probe\n'
  printf '%s\n' '----------------------------------------------------------------------------'
  printf '%-4s %-15s %-9s %s\n' 'No.' 'Actual' 'History' 'Component'
  printf '%s\n' '----------------------------------------------------------------------------'
  for n in $(seq 1 18); do
    printf -v formatted '%02d' "$n"
    name="$(installation_step_name "$n")"
    if installation_step_probe "$n" >/dev/null 2>&1; then
      actual='INSTALLED'; installed+=("$formatted")
    else
      actual='NOT INSTALLED'; missing+=("$formatted")
    fi
    [[ -f "${STEP_DIR}/${n}.ok" ]] && history='DONE' || history='-'
    printf '%-4s %-15s %-9s %s\n' "$formatted" "$actual" "$history" "$name"
  done
  printf '%s\n' '----------------------------------------------------------------------------'
  printf 'Installed     : %s\n' "${installed[*]:-none}"
  printf 'Not installed : %s\n' "${missing[*]:-none}"
  printf 'Total         : %d/18\n' "${#installed[@]}"
  printf '\nActual = وضعیت واقعی همین سرور. History = این مرحله قبلاً توسط Manager با موفقیت ثبت شده است.\n'
}

# Supabase official repository uses master as its default branch.
test_supabase_source() {
  require_dir "${SUPABASE_SOURCE}/.git" || return 1
  require_file "${SUPABASE_SOURCE}/docker/docker-compose.yml" || return 1
  require_file "${SUPABASE_ROOT}/docker-compose.yml" || return 1
  require_file "${SUPABASE_ROOT}/.env" || return 1
  [[ "$(git -C "$SUPABASE_SOURCE" remote get-url origin)" == "https://github.com/supabase/supabase.git" ]] || return 1
  [[ "$(git -C "$SUPABASE_SOURCE" branch --show-current)" == "master" ]] || return 1
  local actual latest
  actual="$(git -C "$SUPABASE_SOURCE" rev-parse HEAD)" || return 1
  latest="$(git -C "$SUPABASE_SOURCE" rev-parse origin/master)" || return 1
  [[ "$actual" == "$latest" ]] || return 1
}

install_step_5() {
  title
  new_log "install-04-supabase-latest"

  if [[ -d "${SUPABASE_SOURCE}/.git" ]]; then
    if [[ -n "$(git -C "$SUPABASE_SOURCE" status --porcelain)" ]]; then
      fail "${SUPABASE_SOURCE} تغییرات commit نشده دارد؛ برای جلوگیری از overwrite مرحله متوقف شد."
      git -C "$SUPABASE_SOURCE" status --short | tee -a "$CURRENT_LOG"
      return 1
    fi
    run_logged "Fetch آخرین Supabase master" git -C "$SUPABASE_SOURCE" fetch origin master || return 1
    run_logged "Checkout Supabase master" git -C "$SUPABASE_SOURCE" checkout master || return 1
    run_logged "Fast-forward Supabase master" git -C "$SUPABASE_SOURCE" pull --ff-only origin master || return 1
  elif [[ -e "$SUPABASE_SOURCE" ]]; then
    fail "${SUPABASE_SOURCE} وجود دارد ولی Git repository نیست."
    return 1
  else
    run_logged "Clone آخرین Supabase رسمی" git clone --branch master --single-branch https://github.com/supabase/supabase.git "$SUPABASE_SOURCE" || return 1
  fi

  if [[ -f "${SUPABASE_ROOT}/.env" ]]; then
    warn "${SUPABASE_ROOT} از قبل فعال است؛ Source رسمی به آخرین master به‌روزرسانی شد ولی runtime/config زنده overwrite نمی‌شود."
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

run_install_step() {
  local n="$1"
  "install_step_${n}"
}

run_all_install() {
  local legacy logical
  for legacy in 2 3 4 5 6 7 8 9 10 11 13 14 15 16 17 18 19 20; do
    logical="$(install_legacy_to_logical "$legacy")"
    if ! run_install_step "$legacy"; then
      printf -v logical '%02d' "$logical"
      fail "اجرای زنجیره‌ای در مرحله ${logical} متوقف شد."
      return 1
    fi
  done
  ok "تمام ۱۸ مرحله نصب با موفقیت اجرا شدند."
}

install_menu() {
  while true; do
    title
    printf '%sمنوی نصب Single Host — ۱۸ مرحله%s\n\n' "$C_BOLD" "$C_RESET"
    printf '  0) بازگشت\n'
    printf '  1) %s مقادیر نصب و Configuration\n' "$(step_badge 2)"
    printf '  2) %s Packageهای پایه + Docker + Node 24\n' "$(step_badge 3)"
    printf '  3) %s دریافت آخرین Spark main\n' "$(step_badge 4)"
    printf '  4) %s دریافت آخرین Supabase رسمی\n' "$(step_badge 5)"
    printf '  5) %s تولید Secretهای Supabase\n' "$(step_badge 6)"
    printf '  6) %s تکمیل Supabase .env\n' "$(step_badge 7)"
    printf '  7) %s Sync Edge Functions + Main Router\n' "$(step_badge 8)"
    printf '  8) %s Provider / Worker Environment\n' "$(step_badge 9)"
    printf '  9) %s Docker Compose hardening/config\n' "$(step_badge 10)"
    printf ' 10) %s Validate و Start Supabase\n' "$(step_badge 11)"
    printf ' 11) %s Build و Deploy Frontend\n' "$(step_badge 13)"
    printf ' 12) %s Nginx Bootstrap\n' "$(step_badge 14)"
    printf ' 13) %s Certificateها\n' "$(step_badge 15)"
    printf ' 14) %s Nginx Production\n' "$(step_badge 16)"
    printf ' 15) %s Schedulerهای Local\n' "$(step_badge 17)"
    printf ' 16) %s TURN/Coturn\n' "$(step_badge 18)"
    printf ' 17) %s Certbot Renewal Hook\n' "$(step_badge 19)"
    printf ' 18) %s Firewall\n' "$(step_badge 20)"
    printf ' 19) اجرای همه ۱۸ مرحله نصب به‌ترتیب\n\n'
    read -r -p "انتخاب: " choice
    case "$choice" in
      0) return ;;
      1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18)
        run_install_step "$(install_logical_to_legacy "$choice")" || true
        pause
        ;;
      19) run_all_install || true; pause ;;
      *) fail "گزینه نامعتبر"; sleep 1 ;;
    esac
  done
}
