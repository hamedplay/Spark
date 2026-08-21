linux_update() {
  title
  new_log "linux-update"
  run_visible "apt update" apt update || return 1
  run_visible "apt upgrade" apt upgrade -y || return 1
  run_report "dpkg audit" dpkg --audit
  if [[ -f /var/run/reboot-required ]]; then
    warn "برای تکمیل update، reboot لازم است."
    cat /var/run/reboot-required.pkgs 2>/dev/null || true
  else
    ok "Reboot اجباری گزارش نشده است."
  fi
}

npm_menu() {
  while true; do
    title
    printf '%sNode / npm Maintenance%s\n\n' "$C_BOLD" "$C_RESET"
    printf '0) بازگشت\n'
    printf '1) نمایش Node/npm version\n'
    printf '2) Update npm global به شاخه 11\n'
    printf '3) npm ci\n'
    printf '4) npm audit کامل\n'
    printf '5) npm audit --omit=dev\n'
    printf '6) npm outdated\n'
    printf '7) npm audit fix --dry-run (بدون تغییر فایل)\n\n'
    read -r -p "انتخاب: " c
    new_log "npm-maintenance"
    case "$c" in
      0) return ;;
      1) run_report "Versions" bash -c 'node --version; npm --version'; pause ;;
      2) run_visible "Update npm" npm install -g 'npm@^11.6.2' || true; pause ;;
      3) run_visible "npm ci" bash -c "cd '$SPARK_ROOT' && npm ci" || true; pause ;;
      4) run_report "npm audit" bash -c "cd '$SPARK_ROOT' && npm audit"; pause ;;
      5) run_report "npm audit production" bash -c "cd '$SPARK_ROOT' && npm audit --omit=dev"; pause ;;
      6) run_report "npm outdated" bash -c "cd '$SPARK_ROOT' && npm outdated"; pause ;;
      7) run_report "npm audit fix dry-run" bash -c "cd '$SPARK_ROOT' && npm audit fix --dry-run"; pause ;;
      *) fail "گزینه نامعتبر"; sleep 1 ;;
    esac
  done
}

external_access_requirements() {
  require_manager_values || return 1
  require_file "${SUPABASE_ROOT}/.env" || return 1
}

ufw_is_active() {
  command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'
}

firewall_optional_allow_port() {
  local port="$1"
  if ufw_is_active; then
    run_logged "UFW allow TCP/${port}" ufw allow "${port}/tcp"
  else
    warn "UFW فعال نیست؛ Spark فقط listener را باز می‌کند. محدودسازی شبکه در این حالت بر عهده Firewall/ACL بیرونی سرور است."
  fi
}

firewall_optional_close_port() {
  local port="$1"
  if ufw_is_active; then
    set +e
    ufw --force delete allow "${port}/tcp" >>"$CURRENT_LOG" 2>&1
    set -e
  fi
}

find_systemd_socket_proxyd() {
  local path
  path="$(command -v systemd-socket-proxyd 2>/dev/null || true)"
  if [[ -n "$path" && -x "$path" ]]; then
    printf '%s\n' "$path"
    return 0
  fi
  for path in /usr/lib/systemd/systemd-socket-proxyd /lib/systemd/systemd-socket-proxyd; do
    if [[ -x "$path" ]]; then
      printf '%s\n' "$path"
      return 0
    fi
  done
  return 1
}

database_external_is_open() {
  systemctl is-active --quiet spark-db-access.socket 2>/dev/null \
    && ss -lnt 2>/dev/null | grep -q ':5432 '
}

studio_external_is_open() {
  [[ -L /etc/nginx/sites-enabled/spark-supabase-admin ]] \
    && ss -lnt 2>/dev/null | grep -q ':8443 '
}

show_operator_credentials() {
  local db_password dashboard_user dashboard_password db_state studio_state public_ip
  require_manager_values || return 1
  require_file "${SUPABASE_ROOT}/.env" || return 1

  db_password="$(env_get "${SUPABASE_ROOT}/.env" POSTGRES_PASSWORD)"
  dashboard_user="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_USERNAME)"
  dashboard_password="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_PASSWORD)"
  dashboard_user="${dashboard_user:-supabase}"
  public_ip="${TURN_PUBLIC_IP:-}"

  [[ -n "$db_password" ]] || { fail "POSTGRES_PASSWORD در Supabase .env پیدا نشد."; return 1; }
  [[ -n "$dashboard_password" ]] || { fail "DASHBOARD_PASSWORD در Supabase .env پیدا نشد."; return 1; }

  db_state="CLOSED"
  database_external_is_open && db_state="OPEN"
  studio_state="CLOSED"
  studio_external_is_open && studio_state="OPEN"

  printf '\n%s%sCredentials مورد استفاده مدیر سیستم%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
  printf '%s\n' '────────────────────────────────────────────────────────────'
  printf '%s\n' 'PostgreSQL'
  printf '  Database : postgres\n'
  printf '  Username : postgres\n'
  printf '  Password : %s\n' "$db_password"
  printf '  Local    : 127.0.0.1:5433\n'
  printf '  External : %s:5432  [%s]\n' "${public_ip:-<server-ip>}" "$db_state"

  printf '\n%s\n' 'Supabase Studio'
  printf '  Username : %s\n' "$dashboard_user"
  printf '  Password : %s\n' "$dashboard_password"
  printf '  URL      : https://%s:8443  [%s]\n' "$API_DOMAIN" "$studio_state"
  printf '%s\n' '────────────────────────────────────────────────────────────'
  warn "فقط Credentialهای انسانی نمایش داده شدند؛ JWT_SECRET و SERVICE_ROLE_KEY و Secretهای داخلی نمایش داده نمی‌شوند."
  info "رمزها در log فایل Spark Manager نوشته نمی‌شوند."
}

write_database_access_units() {
  local proxyd="$1"
  cat >/etc/systemd/system/spark-db-access.socket <<'EOF_SOCKET'
[Unit]
Description=Spark external PostgreSQL access socket

[Socket]
ListenStream=0.0.0.0:5432
NoDelay=true

[Install]
WantedBy=sockets.target
EOF_SOCKET

  cat >/etc/systemd/system/spark-db-access.service <<EOF_SERVICE
[Unit]
Description=Spark PostgreSQL TCP proxy to local Supavisor
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

cleanup_database_access_runtime() {
  set +e
  systemctl disable --now spark-db-access.socket >>"$CURRENT_LOG" 2>&1
  systemctl stop spark-db-access.service >>"$CURRENT_LOG" 2>&1
  rm -f /etc/systemd/system/spark-db-access.socket /etc/systemd/system/spark-db-access.service
  systemctl daemon-reload >>"$CURRENT_LOG" 2>&1
  systemctl reset-failed spark-db-access.service spark-db-access.socket >>"$CURRENT_LOG" 2>&1
  set -e
  firewall_optional_close_port 5432
}

open_database_external_access() {
  local proxyd
  external_access_requirements || return 1

  if database_external_is_open; then
    ok "Database access از قبل روی TCP/5432 باز است."
    return 0
  fi
  if ! timeout 3 bash -c '</dev/tcp/127.0.0.1/5433' >/dev/null 2>&1; then
    fail "Supavisor داخلی روی 127.0.0.1:5433 در دسترس نیست؛ ابتدا Supabase را بررسی کنید."
    return 1
  fi
  proxyd="$(find_systemd_socket_proxyd)" || {
    fail "systemd-socket-proxyd روی سیستم پیدا نشد."
    return 1
  }
  if ! confirm_word "Database روی ${TURN_PUBLIC_IP:-<server-ip>}:5432 باز می‌شود. برای بستن دوباره از همین منو Close Database را اجرا کنید." "OPEN"; then
    warn "لغو شد."
    return 1
  fi

  firewall_optional_allow_port 5432 || return 1
  write_database_access_units "$proxyd"
  if ! run_logged "Reload systemd" systemctl daemon-reload; then
    cleanup_database_access_runtime
    return 1
  fi
  if ! run_logged "Open PostgreSQL TCP/5432" systemctl enable --now spark-db-access.socket; then
    cleanup_database_access_runtime
    return 1
  fi

  if ! database_external_is_open; then
    fail "Listener TCP/5432 ایجاد نشد؛ rollback انجام می‌شود."
    cleanup_database_access_runtime
    return 1
  fi
  if ! timeout 4 bash -c '</dev/tcp/127.0.0.1/5432' >/dev/null 2>&1; then
    fail "TCP/5432 باز شد ولی Proxy تا Supavisor پاسخ نداد؛ rollback انجام می‌شود."
    cleanup_database_access_runtime
    return 1
  fi

  ok "Database access باز شد: ${TURN_PUBLIC_IP:-<server-ip>}:5432"
  info "Database=postgres  Username=postgres؛ رمز را از گزینه نمایش Credentialها ببینید."
}

close_database_external_access() {
  cleanup_database_access_runtime
  if ss -lnt 2>/dev/null | grep -q ':5432 '; then
    fail "هنوز listener دیگری روی TCP/5432 وجود دارد."
    ss -lntp | grep ':5432' | tee -a "$CURRENT_LOG" || true
    return 1
  fi
  ok "دسترسی خارجی Database بسته شد. Supavisor داخلی 127.0.0.1:5433 بدون تغییر باقی ماند."
}

write_supabase_studio_gateway() {
  cat >/etc/nginx/sites-available/spark-supabase-admin <<EOF_NGINX
server {
    listen 8443 ssl;
    server_name ${API_DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${API_DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$spark_connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
EOF_NGINX
}

open_supabase_studio_access() {
  local dashboard_user dashboard_password backup="" had_previous=0
  external_access_requirements || return 1
  require_file "/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem" || return 1
  require_file "/etc/letsencrypt/live/${API_DOMAIN}/privkey.pem" || return 1
  if [[ ! -e /etc/nginx/sites-enabled/spark ]]; then
    fail "Nginx Production فعال نیست؛ ابتدا مرحله 16 نصب را اجرا کنید."
    return 1
  fi
  if studio_external_is_open; then
    ok "Supabase Studio از قبل روی HTTPS/8443 باز است."
    return 0
  fi

  dashboard_user="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_USERNAME)"
  dashboard_password="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_PASSWORD)"
  dashboard_user="${dashboard_user:-supabase}"
  [[ -n "$dashboard_password" ]] || { fail "DASHBOARD_PASSWORD موجود نیست."; return 1; }

  if ! confirm_word "Supabase Studio روی https://${API_DOMAIN}:8443 باز می‌شود. برای بستن دوباره Close Supabase Studio را اجرا کنید." "OPEN"; then
    warn "لغو شد."
    return 1
  fi

  if [[ -f /etc/nginx/sites-available/spark-supabase-admin ]]; then
    backup="$(mktemp)"
    cp -a /etc/nginx/sites-available/spark-supabase-admin "$backup"
    had_previous=1
  fi

  firewall_optional_allow_port 8443 || { rm -f "$backup"; return 1; }
  write_supabase_studio_gateway
  ln -sfn /etc/nginx/sites-available/spark-supabase-admin /etc/nginx/sites-enabled/spark-supabase-admin

  if ! run_logged "Nginx config test" nginx -t || ! run_logged "Reload Nginx" systemctl reload nginx; then
    firewall_optional_close_port 8443
    if (( had_previous )); then
      cp -a "$backup" /etc/nginx/sites-available/spark-supabase-admin
      ln -sfn /etc/nginx/sites-available/spark-supabase-admin /etc/nginx/sites-enabled/spark-supabase-admin
    else
      rm -f /etc/nginx/sites-enabled/spark-supabase-admin /etc/nginx/sites-available/spark-supabase-admin
    fi
    nginx -t >>"$CURRENT_LOG" 2>&1 && systemctl reload nginx >>"$CURRENT_LOG" 2>&1 || true
    rm -f "$backup"
    return 1
  fi

  if ! studio_external_is_open; then
    fail "Nginx روی 8443 listen نشد؛ rollback انجام می‌شود."
    firewall_optional_close_port 8443
    rm -f /etc/nginx/sites-enabled/spark-supabase-admin /etc/nginx/sites-available/spark-supabase-admin
    nginx -t >>"$CURRENT_LOG" 2>&1 && systemctl reload nginx >>"$CURRENT_LOG" 2>&1 || true
    rm -f "$backup"
    return 1
  fi

  if ! curl -fsSkL --connect-timeout 5 --max-time 15 \
      --resolve "${API_DOMAIN}:8443:127.0.0.1" \
      -u "${dashboard_user}:${dashboard_password}" \
      "https://${API_DOMAIN}:8443/" -o /dev/null; then
    fail "8443 باز شد ولی Supabase Studio پاسخ معتبر نداد؛ rollback انجام می‌شود."
    firewall_optional_close_port 8443
    if (( had_previous )); then
      cp -a "$backup" /etc/nginx/sites-available/spark-supabase-admin
      ln -sfn /etc/nginx/sites-available/spark-supabase-admin /etc/nginx/sites-enabled/spark-supabase-admin
    else
      rm -f /etc/nginx/sites-enabled/spark-supabase-admin /etc/nginx/sites-available/spark-supabase-admin
    fi
    nginx -t >>"$CURRENT_LOG" 2>&1 && systemctl reload nginx >>"$CURRENT_LOG" 2>&1 || true
    rm -f "$backup"
    return 1
  fi

  rm -f "$backup"
  ok "Supabase Studio باز شد: https://${API_DOMAIN}:8443"
  info "Username=${dashboard_user}؛ رمز را از گزینه نمایش Credentialها ببینید."
}

close_supabase_studio_access() {
  rm -f /etc/nginx/sites-enabled/spark-supabase-admin /etc/nginx/sites-available/spark-supabase-admin
  firewall_optional_close_port 8443
  run_logged "Nginx config test" nginx -t || return 1
  run_logged "Reload Nginx" systemctl reload nginx || return 1

  if studio_external_is_open; then
    fail "هنوز listener مدیریتی روی 8443 باقی مانده است."
    ss -lntp | grep ':8443' | tee -a "$CURRENT_LOG" || true
    return 1
  fi
  ok "دسترسی خارجی Supabase Studio بسته شد."
}

security_access_wait() {
  local _
  printf '\n'
  read -r -p "برای بازگشت به این منو Enter بزنید..." _
}

open_supabase_admin_access() {
  local choice db_state studio_state
  while true; do
    db_state="CLOSED"
    database_external_is_open && db_state="OPEN"
    studio_state="CLOSED"
    studio_external_is_open && studio_state="OPEN"

    printf '\n%s%sAccess & Credentials%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
    printf 'Database 5432: %s   |   Supabase Studio 8443: %s\n\n' "$db_state" "$studio_state"
    printf '0) بازگشت\n'
    printf '1) نمایش رمزها و Credentialهای مورد استفاده مدیر\n'
    printf '2) باز کردن Database روی TCP/5432\n'
    printf '3) بستن Database روی TCP/5432\n'
    printf '4) باز کردن Supabase Studio روی HTTPS/8443\n'
    printf '5) بستن Supabase Studio روی HTTPS/8443\n\n'
    read -r -p "انتخاب: " choice

    case "$choice" in
      0) return 0 ;;
      1) new_log "operator-credentials"; show_operator_credentials || true; security_access_wait ;;
      2) new_log "database-access-open"; open_database_external_access || true; security_access_wait ;;
      3) new_log "database-access-close"; close_database_external_access || true; security_access_wait ;;
      4) new_log "supabase-studio-open"; open_supabase_studio_access || true; security_access_wait ;;
      5) new_log "supabase-studio-close"; close_supabase_studio_access || true; security_access_wait ;;
      *) fail "گزینه نامعتبر"; sleep 1 ;;
    esac
  done
}

close_supabase_admin_access() {
  new_log "supabase-studio-close"
  close_supabase_studio_access
}

resource_status() {
  title
  new_log "resource-status"
  {
    echo "== Time / Uptime =="
    date -Is
    uptime
    echo
    echo "== CPU / Load =="
    nproc
    cat /proc/loadavg
    echo
    echo "== Memory =="
    free -h
    echo
    echo "== Disk =="
    df -hT
    echo
    echo "== Inodes =="
    df -ih
    echo
    echo "== Top CPU =="
    ps -eo pid,comm,%cpu,%mem --sort=-%cpu | head -n 15
    echo
    echo "== Top Memory =="
    ps -eo pid,comm,%cpu,%mem --sort=-%mem | head -n 15
    echo
    echo "== Docker =="
    docker stats --no-stream 2>/dev/null || true
    echo
    echo "== Listening =="
    ss -lntup
  } 2>&1 | tee -a "$CURRENT_LOG"
}

service_menu() {
  while true; do
    title
    printf '%sService Management%s\n\n' "$C_BOLD" "$C_RESET"
    printf '0) بازگشت\n1) Status همه سرویس‌ها\n2) Restart Functions + Worker\n3) Reload Nginx\n4) Restart Coturn\n5) Restart Supabase stack\n6) Restart Scheduler timers\n\n'
    read -r -p "انتخاب: " c
    new_log "service-management"
    case "$c" in
      0) return ;;
      1)
        run_report "Nginx" systemctl status nginx --no-pager
        run_report "Coturn" systemctl status coturn --no-pager
        run_report "Docker" compose ps
        run_report "Timers" systemctl list-timers 'spark-*' --no-pager
        pause ;;
      2) run_visible "Restart Functions + Worker" bash -c "cd '$SUPABASE_ROOT' && docker compose up -d --force-recreate functions avatar-worker" || true; pause ;;
      3) run_visible "Nginx test/reload" bash -c 'nginx -t && systemctl reload nginx' || true; pause ;;
      4) run_visible "Restart Coturn" systemctl restart coturn || true; pause ;;
      5)
        if confirm_word "کل Supabase stack recreate/restart می‌شود و ممکن است چند لحظه اختلال ایجاد کند." "RESTART"; then
          run_visible "Restart Supabase stack" bash -c "cd '$SUPABASE_ROOT' && docker compose up -d --force-recreate" || true
        fi
        pause ;;
      6)
        run_visible "Restart timers" bash -c 'systemctl restart spark-daily-report.timer spark-minutes-reminder.timer spark-decision-due.timer spark-notification-outbox.timer' || true
        pause ;;
      *) fail "گزینه نامعتبر"; sleep 1 ;;
    esac
  done
}

certificate_menu() {
  while true; do
    title
    printf '%sCertificate Management%s\n\n' "$C_BOLD" "$C_RESET"
    printf '0) بازگشت\n1) نمایش Certificateها\n2) Renewal dry-run\n3) اجرای certbot renew\n\n'
    read -r -p "انتخاب: " c
    new_log "certificate-management"
    case "$c" in
      0) return ;;
      1) run_report "Certificates" certbot certificates; pause ;;
      2) run_visible "Renewal dry-run" certbot renew --dry-run || true; pause ;;
      3) run_visible "Certbot renew" certbot renew || true; pause ;;
      *) fail "گزینه نامعتبر"; sleep 1 ;;
    esac
  done
}

version_info() {
  title
  new_log "version-info"
  {
    echo "Spark Manager: $SPARK_MANAGER_VERSION"
    echo "OS: $(. /etc/os-release; echo "$PRETTY_NAME")"
    echo "Kernel: $(uname -r)"
    command -v docker >/dev/null && docker --version
    command -v docker >/dev/null && docker compose version
    command -v node >/dev/null && node --version
    command -v npm >/dev/null && npm --version
    command -v nginx >/dev/null && nginx -v 2>&1
    command -v certbot >/dev/null && certbot --version
    if [[ -d "${SPARK_ROOT}/.git" ]]; then
      echo "Spark commit: $(git -C "$SPARK_ROOT" rev-parse HEAD)"
      echo "Spark branch: $(git -C "$SPARK_ROOT" branch --show-current)"
      echo "Spark dirty: $(test -z "$(git -C "$SPARK_ROOT" status --porcelain)" && echo no || echo yes)"
    fi
    if [[ -d "${SUPABASE_SOURCE}/.git" ]]; then
      echo "Supabase pinned commit: $(git -C "$SUPABASE_SOURCE" rev-parse HEAD)"
    fi
  } 2>&1 | tee -a "$CURRENT_LOG"
}

self_update() {
  title
  new_log "manager-self-update"
  local tmp file
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/lib"
  local files=(
    spark
    lib/core.sh
    lib/install-base.sh
    lib/install-platform-a.sh
    lib/install-platform-b.sh
    lib/install-platform-c.sh
    lib/tests-backup.sh
    lib/update.sh
    lib/admin.sh
  )
  for file in "${files[@]}"; do
    if ! run_logged "دریافت ${file}" curl -fsSL "${RAW_BASE}/${file}" -o "${tmp}/${file}"; then
      rm -rf "$tmp"
      return 1
    fi
  done
  if ! bash -n "${tmp}/spark" >>"$CURRENT_LOG" 2>&1; then
    fail "Entrypoint دانلودشده syntax معتبر ندارد."
    show_failure_log
    rm -rf "$tmp"
    return 1
  fi
  for file in "${tmp}"/lib/*.sh; do
    if ! bash -n "$file" >>"$CURRENT_LOG" 2>&1; then
      fail "یکی از moduleهای دانلودشده syntax معتبر ندارد."
      show_failure_log
      rm -rf "$tmp"
      return 1
    fi
  done
  if ! run_logged "نصب atomically Spark Manager" install_manager_from_dir "$tmp"; then
    rm -rf "$tmp"
    return 1
  fi
  rm -rf "$tmp"
  ok "Spark Manager به‌روز شد. برای بارگذاری نسخه جدید، از منو خارج و دوباره spark را اجرا کنید."
}
