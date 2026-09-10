functions_reference_turn_secret() {
  grep -Rqs --include='*.ts' --include='*.js' 'TURN_SHARED_SECRET' "${SPARK_ROOT}/supabase/functions"
}

test_turn() {
  systemctl is-active --quiet coturn || return 1
  ss -lntup | grep -Eq ':(3478|5349)\b' || return 1
  turnutils_stunclient "$TURN_DOMAIN" -p 3478 || return 1
}

install_step_16() {
  title
  new_log "install-16-turn"
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
  chown root:turnserver /etc/turnserver.conf
  chmod 0640 /etc/turnserver.conf
  if grep -q '^TURNSERVER_ENABLED=' /etc/default/coturn 2>/dev/null; then
    sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  else
    printf '\nTURNSERVER_ENABLED=1\n' >>/etc/default/coturn
  fi

  if functions_reference_turn_secret; then
    info "Source current TURN_SHARED_SECRET consumes the same Secret to functions-extra.env is added."
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_DOMAIN "$TURN_DOMAIN"
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_SHARED_SECRET "$secret"
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_URL "turn:${TURN_DOMAIN}:3478?transport=udp"
    env_set "${CONFIG_DIR}/functions-extra.env" TURN_TCP_URL "turn:${TURN_DOMAIN}:3478?transport=tcp"
    env_set "${CONFIG_DIR}/functions-extra.env" TURNS_URL "turns:${TURN_DOMAIN}:5349?transport=tcp"
    chmod 600 "${CONFIG_DIR}/functions-extra.env"
    if [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]]; then
      run_logged "Reload Functions for TURN env" bash -c "cd '$SUPABASE_ROOT' && docker compose up -d --force-recreate functions" || return 1
    fi
  fi

  run_logged "Activation coturn" systemctl enable --now coturn || return 1
  if run_logged "test TURN/STUN" test_turn; then
    mark_step 16
  else
    unmark_step 16
    return 1
  fi
}

test_certbot_hook() {
  systemctl is-enabled --quiet certbot.timer || return 1
  systemctl is-active --quiet certbot.timer || return 1
  require_file /etc/systemd/system/certbot.service.d/spark-turn.conf || return 1
}

install_step_17() {
  title
  new_log "install-17-certbot-renewal"
  require_manager_values || return 1
  mkdir -p /etc/systemd/system/certbot.service.d
  cat >/etc/systemd/system/certbot.service.d/spark-turn.conf <<EOF
[Service]
ExecStartPost=/usr/bin/install -m 0640 -o turnserver -g turnserver /etc/letsencrypt/live/${TURN_DOMAIN}/fullchain.pem /etc/coturn/certs/fullchain.pem
ExecStartPost=/usr/bin/install -m 0640 -o turnserver -g turnserver /etc/letsencrypt/live/${TURN_DOMAIN}/privkey.pem /etc/coturn/certs/privkey.pem
ExecStartPost=/usr/bin/systemctl try-restart coturn.service
EOF
  run_logged "systemd daemon-reload" systemctl daemon-reload || return 1
  run_logged "Activation certbot.timer" systemctl enable --now certbot.timer || return 1
  run_visible "Certbot renewal dry-run" certbot renew --dry-run || return 1
  if run_logged "test Certbot hook/timer" test_certbot_hook; then
    mark_step 17
  else
    unmark_step 17
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

install_step_18() {
  title
  new_log "install-18-firewall"
  require_manager_values || return 1
  local db_was_open=0 studio_was_open=0
  database_external_is_open 2>/dev/null && db_was_open=1
  studio_external_is_open 2>/dev/null && studio_was_open=1

  if ! confirm_word "This step UFW  reset does; SSH/HTTP/HTTPS/TURN They remain open and the current situation Database 5432 / Studio 8443 is maintained." "FIREWALL"; then
    warn "change Firewall canceled."
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
  if run_logged "test Firewall and exposure managed" test_firewall; then
    mark_step 18
  else
    unmark_step 18
    return 1
  fi
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

install_step_4() {
  title
  new_log "install-04-supabase-latest"

  if [[ -d "${SUPABASE_SOURCE}/.git" ]]; then
    if [[ -n "$(git -C "$SUPABASE_SOURCE" status --porcelain)" ]]; then
      fail "${SUPABASE_SOURCE} changes commit has not to prevent overwrite The stage stopped."
      git -C "$SUPABASE_SOURCE" status --short | tee -a "$CURRENT_LOG"
      return 1
    fi
    run_logged "Fetch last Supabase master" git -C "$SUPABASE_SOURCE" fetch origin master || return 1
    run_logged "Checkout Supabase master" git -C "$SUPABASE_SOURCE" checkout master || return 1
    run_logged "Fast-forward Supabase master" git -C "$SUPABASE_SOURCE" pull --ff-only origin master || return 1
  elif [[ -e "$SUPABASE_SOURCE" ]]; then
    fail "${SUPABASE_SOURCE} There is but Git repository is not."
    return 1
  else
    run_logged "Clone last Supabase official" git clone --branch master --single-branch https://github.com/supabase/supabase.git "$SUPABASE_SOURCE" || return 1
  fi

  if [[ -f "${SUPABASE_ROOT}/.env" ]]; then
    warn "${SUPABASE_ROOT} It is already active; Source Official to the last master Updated but runtime/config alive overwrite can't."
    rm -f "${SUPABASE_ROOT}/.spark-supabase-source-commit"
  else
    rm -rf "$SUPABASE_ROOT"
    mkdir -p "$SUPABASE_ROOT"
    run_logged "Last copy Docker snapshot official Supabase" cp -a "${SUPABASE_SOURCE}/docker/." "$SUPABASE_ROOT/" || return 1
    run_logged "create .env primary" cp "${SUPABASE_ROOT}/.env.example" "${SUPABASE_ROOT}/.env" || return 1
    chmod 600 "${SUPABASE_ROOT}/.env"
    rm -f "${SUPABASE_ROOT}/.spark-supabase-source-commit"
  fi

  if run_logged "The last test Supabase source and runtime" test_supabase_source; then
    mark_step 4
  else
    unmark_step 4
    return 1
  fi
}

run_install_step() {
  local n="$1"
  "install_step_${n}"
}

run_all_install() {
  local n
  for n in $(seq 1 18); do
    if ! run_install_step "$n"; then
      printf -v n '%02d' "$n"
      fail "Chain execution in step ${n} it stopped."
      return 1
    fi
  done
  ok "all 18 The installation phase was executed successfully."
}

install_menu() {
  while true; do
    title
    printf '%sInstallation menu Single Host — 18 step%s\n\n' "$C_BOLD" "$C_RESET"
    printf '  0) back\n'
    printf '  1) %s Installation values ​​and Configuration\n' "$(step_badge 1)"
    printf '  2) %s PackageBasics + Docker + Node 24\n' "$(step_badge 2)"
    printf '  3) %s Get the latest Spark main\n' "$(step_badge 3)"
    printf '  4) %s Get the latest Supabase official\n' "$(step_badge 4)"
    printf '  5) %s production Secrets Supabase\n' "$(step_badge 5)"
    printf '  6) %s complete Supabase .env\n' "$(step_badge 6)"
    printf '  7) %s Sync Edge Functions + Main Router\n' "$(step_badge 7)"
    printf '  8) %s Provider / Worker Environment\n' "$(step_badge 8)"
    printf '  9) %s Docker Compose hardening/config\n' "$(step_badge 9)"
    printf ' 10) %s Validate and Start Supabase\n' "$(step_badge 10)"
    printf ' 11) %s Build and Deploy Frontend\n' "$(step_badge 11)"
    printf ' 12) %s Nginx Bootstrap\n' "$(step_badge 12)"
    printf ' 13) %s Certificates\n' "$(step_badge 13)"
    printf ' 14) %s Nginx Production\n' "$(step_badge 14)"
    printf ' 15) %s Schedulers Local\n' "$(step_badge 15)"
    printf ' 16) %s TURN/Coturn\n' "$(step_badge 16)"
    printf ' 17) %s Certbot Renewal Hook\n' "$(step_badge 17)"
    printf ' 18) %s Firewall\n' "$(step_badge 18)"
    printf ' 19) Run all 18 Installation step respectively\n\n'
    read -r -p "selection: " choice
    case "$choice" in
      0) return ;;
      1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18)
        run_install_step "$choice" || true
        pause
        ;;
      19) run_all_install || true; pause ;;
      *) fail "Invalid option"; sleep 1 ;;
    esac
  done
}
