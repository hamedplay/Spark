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

open_supabase_admin_access() {
  title
  new_log "supabase-admin-open"
  require_manager_values || return 1
  require_file "/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem" || return 1
  if [[ ! -e /etc/nginx/sites-enabled/spark ]]; then
    fail "Nginx Production فعال نیست؛ ابتدا مرحله 16 نصب را اجرا کنید."
    return 1
  fi
  if ! confirm_word "برای حفظ معماری، Docker port 8000 عمومی نمی‌شود. یک Gateway مدیریتی TLS روی 8443 فقط برای ${ADMIN_CIDR} ساخته می‌شود." "OPEN"; then
    warn "لغو شد."
    return 1
  fi
  cat >/etc/nginx/sites-available/spark-supabase-admin <<EOF
server {
    listen 8443 ssl;
    server_name ${API_DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${API_DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    allow ${ADMIN_CIDR};
    deny all;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$spark_connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF
  ln -sfn /etc/nginx/sites-available/spark-supabase-admin /etc/nginx/sites-enabled/spark-supabase-admin
  if ! run_logged "Nginx config test" nginx -t; then
    rm -f /etc/nginx/sites-enabled/spark-supabase-admin /etc/nginx/sites-available/spark-supabase-admin
    return 1
  fi
  if ufw status | grep -q "Status: active"; then
    run_logged "UFW allow 8443 فقط از ADMIN_CIDR" ufw allow from "$ADMIN_CIDR" to any port 8443 proto tcp || return 1
  fi
  run_logged "Reload Nginx" systemctl reload nginx || return 1
  if ss -lnt | grep -q ':8443 '; then
    ok "دسترسی مدیریتی: https://${API_DOMAIN}:8443 — فقط ${ADMIN_CIDR}"
    ok "Kong همچنان فقط روی 127.0.0.1:8000 bind است."
  else
    fail "Port 8443 listen نشد."
    return 1
  fi
}

close_supabase_admin_access() {
  title
  new_log "supabase-admin-close"
  require_manager_values || return 1
  rm -f /etc/nginx/sites-enabled/spark-supabase-admin /etc/nginx/sites-available/spark-supabase-admin
  if ufw status | grep -q "Status: active"; then
    set +e
    ufw --force delete allow from "$ADMIN_CIDR" to any port 8443 proto tcp >>"$CURRENT_LOG" 2>&1
    set -e
  fi
  run_logged "Nginx config test" nginx -t || return 1
  run_logged "Reload Nginx" systemctl reload nginx || return 1
  if ! ss -lnt | grep -q ':8443 '; then
    ok "دسترسی مدیریتی مستقیم Supabase بسته شد."
  else
    fail "هنوز listener دیگری روی 8443 وجود دارد؛ بررسی دستی لازم است."
    ss -lntp | grep ':8443' | tee -a "$CURRENT_LOG" || true
    return 1
  fi
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
