write_nginx_bootstrap() {
  cat >/etc/nginx/sites-available/spark-bootstrap <<EOF
server {
    listen 80;
    server_name ${APP_DOMAIN} ${WWW_DOMAIN} ${API_DOMAIN} ${TURN_DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/acme;
    }

    location / {
        return 404;
    }
}
EOF
}

install_step_14() {
  title
  new_log "install-14-nginx-bootstrap"
  require_manager_values || return 1
  mkdir -p /var/www/acme
  chown -R www-data:www-data /var/www/acme
  if [[ -L /etc/nginx/sites-enabled/spark ]]; then
    warn "Nginx Production از قبل فعال است؛ Bootstrap جایگزین نمی‌شود."
    if run_logged "Nginx syntax" nginx -t; then mark_step 14; return 0; else return 1; fi
  fi
  write_nginx_bootstrap
  ln -sfn /etc/nginx/sites-available/spark-bootstrap /etc/nginx/sites-enabled/spark-bootstrap
  rm -f /etc/nginx/sites-enabled/default
  run_logged "Nginx syntax" nginx -t || return 1
  run_logged "Reload Nginx" systemctl reload nginx || return 1
  if systemctl is-active --quiet nginx; then mark_step 14; ok "Bootstrap Nginx فعال است."; else return 1; fi
}

cert_live_dir_for_domain() {
  local domain="$1" dir
  for dir in "/etc/letsencrypt/live/${domain}" /etc/letsencrypt/live/"${domain}"-*; do
    [[ -d "$dir" ]] || continue
    [[ -f "$dir/fullchain.pem" && -f "$dir/privkey.pem" ]] || continue
    openssl x509 -in "$dir/fullchain.pem" -noout -checkend 0 >/dev/null 2>&1 || continue
    if openssl x509 -in "$dir/fullchain.pem" -noout -ext subjectAltName 2>/dev/null \
      | grep -Eq "(^|[[:space:],])DNS:${domain}([[:space:],]|$)"; then
      printf '%s\n' "$dir"
      return 0
    fi
  done
  return 1
}

test_certificates() {
  certbot certificates || return 1
  cert_live_dir_for_domain "$APP_DOMAIN" >/dev/null || return 1
  cert_live_dir_for_domain "$API_DOMAIN" >/dev/null || return 1
  cert_live_dir_for_domain "$TURN_DOMAIN" >/dev/null || return 1
}

install_step_15() {
  title
  new_log "install-15-certificates"
  require_manager_values || return 1
  test_values || { fail "تنظیمات دامنه معتبر نیست؛ ابتدا مرحله 01 – Configuration را اصلاح کنید."; return 1; }
  run_logged "Certificate دامنه Frontend" certbot certonly --webroot -w /var/www/acme -d "$APP_DOMAIN" -d "$WWW_DOMAIN" --email "$LE_EMAIL" --agree-tos --non-interactive --keep-until-expiring || return 1
  run_logged "Certificate دامنه API" certbot certonly --webroot -w /var/www/acme -d "$API_DOMAIN" --email "$LE_EMAIL" --agree-tos --non-interactive --keep-until-expiring || return 1
  run_logged "Certificate دامنه TURN" certbot certonly --webroot -w /var/www/acme -d "$TURN_DOMAIN" --email "$LE_EMAIL" --agree-tos --non-interactive --keep-until-expiring || return 1
  if run_logged "تست Certificateها" test_certificates; then
    mark_step 15
  else
    unmark_step 15
    return 1
  fi
}

write_nginx_production() {
  local app_cert_dir api_cert_dir
  app_cert_dir="$(cert_live_dir_for_domain "$APP_DOMAIN")" || {
    fail "Certificate معتبر برای ${APP_DOMAIN} پیدا نشد."
    return 1
  }
  api_cert_dir="$(cert_live_dir_for_domain "$API_DOMAIN")" || {
    fail "Certificate معتبر برای ${API_DOMAIN} پیدا نشد."
    return 1
  }

  cat >/etc/nginx/sites-available/spark <<EOF
map \$http_upgrade \$spark_connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name ${APP_DOMAIN} ${WWW_DOMAIN} ${API_DOMAIN} ${TURN_DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/acme;
    }

    location / {
        if (\$host = ${TURN_DOMAIN}) { return 404; }
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${APP_DOMAIN} ${WWW_DOMAIN};

    ssl_certificate ${app_cert_dir}/fullchain.pem;
    ssl_certificate_key ${app_cert_dir}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    root /var/www/spark;
    index index.html;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;

    location /assets/ {
        try_files \$uri =404;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control no-store;
    }
}

server {
    listen 443 ssl http2;
    server_name ${API_DOMAIN};

    ssl_certificate ${api_cert_dir}/fullchain.pem;
    ssl_certificate_key ${api_cert_dir}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    client_max_body_size 50m;

    location ^~ /realtime/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$spark_connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
    }

    location ^~ /functions/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    location ^~ /auth/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /rest/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /storage/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /graphql/v1 {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        return 404;
    }
}
EOF
}

test_nginx_production() {
  nginx -t || return 1
  systemctl is-active --quiet nginx || return 1
  [[ -L /etc/nginx/sites-enabled/spark ]] || return 1
  [[ ! -e /etc/nginx/sites-enabled/spark-bootstrap ]] || return 1
}

install_step_16() {
  title
  new_log "install-16-nginx-production"
  require_manager_values || return 1
  test_certificates >>"$CURRENT_LOG" 2>&1 || { fail "Certificateها آماده نیستند؛ مرحله 13 – TLS certificates را اجرا کنید."; return 1; }
  local old=""
  if [[ -f /etc/nginx/sites-available/spark ]]; then
    old="$(mktemp)"
    cp -a /etc/nginx/sites-available/spark "$old"
  fi
  if ! write_nginx_production; then
    [[ -n "$old" ]] && cp -a "$old" /etc/nginx/sites-available/spark
    rm -f "$old"
    return 1
  fi
  ln -sfn /etc/nginx/sites-available/spark /etc/nginx/sites-enabled/spark
  rm -f /etc/nginx/sites-enabled/spark-bootstrap
  if ! run_logged "Nginx production syntax" nginx -t; then
    if [[ -n "$old" ]]; then cp -a "$old" /etc/nginx/sites-available/spark; fi
    rm -f "$old"
    return 1
  fi
  rm -f "$old"
  run_logged "Reload Nginx" systemctl reload nginx || return 1
  if run_logged "تست Nginx Production" test_nginx_production; then
    mark_step 16
  else
    unmark_step 16
    return 1
  fi
}

write_scheduler_units() {
  cat >/etc/systemd/system/spark-daily-report.service <<'EOF'
[Unit]
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
EnvironmentFile=/opt/spark-supabase/.env
ExecStart=/usr/bin/curl --fail --silent --show-error -X POST http://127.0.0.1:8000/functions/v1/send-daily-meetings -H content-type:application/json -H x-cron-secret:${DAILY_REPORT_CRON_SECRET} --data={"scheduled":true}
EOF
  cat >/etc/systemd/system/spark-daily-report.timer <<'EOF'
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF

  cat >/etc/systemd/system/spark-minutes-reminder.service <<'EOF'
[Unit]
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
EnvironmentFile=/opt/spark-supabase/.env
ExecStart=/usr/bin/curl --fail --silent --show-error -X POST http://127.0.0.1:8000/functions/v1/process-minutes-reminders -H content-type:application/json -H x-cron-secret:${MINUTES_REMINDER_CRON_SECRET} --data={}
EOF
  cat >/etc/systemd/system/spark-minutes-reminder.timer <<'EOF'
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF

  cat >/etc/systemd/system/spark-decision-due.service <<'EOF'
[Unit]
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
EnvironmentFile=/opt/spark-supabase/.env
ExecStart=/usr/bin/curl --fail --silent --show-error -X POST http://127.0.0.1:8000/functions/v1/process-decision-due-overdue -H content-type:application/json -H x-cron-secret:${DECISION_DUE_CRON_SECRET} --data={}
EOF
  cat >/etc/systemd/system/spark-decision-due.timer <<'EOF'
[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
Persistent=true

[Install]
WantedBy=timers.target
EOF

  cat >/etc/systemd/system/spark-notification-outbox.service <<'EOF'
[Unit]
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
EnvironmentFile=/opt/spark-supabase/.env
ExecStart=/usr/bin/curl --fail --silent --show-error -X POST http://127.0.0.1:8000/functions/v1/process-notification-outbox -H content-type:application/json -H x-cron-secret:${NOTIFICATION_OUTBOX_CRON_SECRET} --data={}
EOF
  cat >/etc/systemd/system/spark-notification-outbox.timer <<'EOF'
[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
Persistent=true

[Install]
WantedBy=timers.target
EOF
}

test_schedulers() {
  local t
  for t in spark-daily-report.timer spark-minutes-reminder.timer spark-decision-due.timer spark-notification-outbox.timer; do
    systemctl is-enabled --quiet "$t" || return 1
    systemctl is-active --quiet "$t" || return 1
  done
  systemctl list-timers 'spark-*' --no-pager || return 1
}

install_step_17() {
  title
  new_log "install-17-schedulers"
  write_scheduler_units
  run_logged "systemd daemon-reload" systemctl daemon-reload || return 1
  local t
  for t in spark-daily-report.timer spark-minutes-reminder.timer spark-decision-due.timer spark-notification-outbox.timer; do
    run_logged "فعال‌سازی ${t}" systemctl enable --now "$t" || return 1
  done
  if run_logged "تست Schedulerها" test_schedulers; then
    mark_step 17
  else
    unmark_step 17
    return 1
  fi
}
