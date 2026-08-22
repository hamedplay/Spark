cleanup_unmark_steps() {
  local step
  for step in "$@"; do
    unmark_step "$step"
  done
}

cleanup_find_database_data_bind() {
  local rendered output rc
  [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] || {
    fail "docker-compose.yml موجود نیست؛ مسیر Database قابل تشخیص نیست." >&2
    return 1
  }
  rendered="$(mktemp)"
  if ! compose config --format json >"$rendered" 2>>"$CURRENT_LOG"; then
    rm -f "$rendered"
    fail "Compose فعلی قابل تحلیل نیست؛ حذف Database برای جلوگیری از حدس متوقف شد." >&2
    return 1
  fi

  set +e
  output="$(python3 - "$rendered" "$SUPABASE_ROOT" <<'PY'
import json
import os
import sys

path, root = sys.argv[1:3]
root = os.path.realpath(root)
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception:
    raise SystemExit(2)

db = (data.get("services") or {}).get("db") or {}
volumes = db.get("volumes") or []
matches = []
for item in volumes:
    source = target = kind = None
    if isinstance(item, dict):
        source = item.get("source")
        target = item.get("target")
        kind = item.get("type")
    elif isinstance(item, str):
        parts = item.split(":")
        if len(parts) >= 2:
            source, target = parts[0], parts[1]
            kind = "bind"
    if target != "/var/lib/postgresql/data" or not source:
        continue
    if kind not in (None, "bind"):
        raise SystemExit(3)
    source = os.path.realpath(source if os.path.isabs(source) else os.path.join(root, source))
    if source == root or not source.startswith(root + os.sep):
        raise SystemExit(4)
    matches.append(source)

if len(matches) != 1:
    raise SystemExit(5)
print(matches[0])
PY
)"
  rc=$?
  set -e
  rm -f "$rendered"
  if (( rc != 0 )) || [[ -z "$output" ]]; then
    fail "Mount دیتابیس با اطمینان قابل تشخیص نیست؛ چیزی حذف نشد." >&2
    return 1
  fi
  printf '%s\n' "$output"
}

cleanup_database_data() {
  local db_data
  new_log "cleanup-database"
  db_data="$(cleanup_find_database_data_bind)" || return 1
  info "PostgreSQL data path: ${db_data}"
  if ! confirm_word "این عملیات تمام داده‌های PostgreSQL را حذف می‌کند و Supabase را متوقف می‌کند. برای بازسازی Runtime باید مرحله 11 را دوباره اجرا کنید؛ migration دیتابیس فقط از مسیر مستقل spark-migrate انجام می‌شود." "DELETE-DATABASE"; then
    warn "حذف Database لغو شد."
    return 1
  fi

  close_database_external_access >/dev/null 2>&1 || true
  close_supabase_studio_access >/dev/null 2>&1 || true
  run_logged "Stop Supabase before Database wipe" compose down --remove-orphans || return 1
  [[ -n "$db_data" && "$db_data" != "/" ]] || { fail "مسیر Database ناامن است؛ حذف متوقف شد."; return 1; }
  rm -rf -- "$db_data"
  if [[ -e "$db_data" ]]; then
    fail "Database data path حذف نشد."
    return 1
  fi
  cleanup_unmark_steps 11
  rm -f "${STEP_DIR}/12.ok"  # legacy marker from removed install step
  ok "Database PostgreSQL کامل حذف شد. Runtime متوقف است؛ برای ساخت مجدد مراحل 11 و 12 را اجرا کنید."
}

cleanup_supabase_runtime() {
  new_log "cleanup-supabase-runtime"
  if ! confirm_word "این عملیات کل Runtime محلی Supabase شامل Database، Storage/runtime data، Compose config و Secretهای داخل /opt/spark-supabase را حذف می‌کند." "DELETE-SUPABASE"; then
    warn "حذف Supabase Runtime لغو شد."
    return 1
  fi

  close_database_external_access >/dev/null 2>&1 || true
  close_supabase_studio_access >/dev/null 2>&1 || true
  if [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]]; then
    compose down --volumes --remove-orphans >>"$CURRENT_LOG" 2>&1 || true
  fi
  rm -rf -- "$SUPABASE_ROOT"
  [[ ! -e "$SUPABASE_ROOT" ]] || { fail "${SUPABASE_ROOT} حذف نشد."; return 1; }
  cleanup_unmark_steps 5 6 7 8 9 10 11 12
  ok "Supabase Runtime حذف شد. Source pin در ${SUPABASE_SOURCE} نگه داشته شد."
}

cleanup_frontend_deploy() {
  new_log "cleanup-frontend"
  if ! confirm_word "این عملیات فقط Frontend deploy شده در /var/www/spark را حذف می‌کند؛ Source repository باقی می‌ماند." "DELETE-FRONTEND"; then
    warn "حذف Frontend لغو شد."
    return 1
  fi
  rm -rf -- /var/www/spark
  cleanup_unmark_steps 13
  [[ ! -e /var/www/spark ]] || { fail "Frontend deploy حذف نشد."; return 1; }
  ok "Frontend deploy حذف شد."
}

cleanup_spark_source() {
  new_log "cleanup-spark-source"
  if ! confirm_word "این عملیات Source repository محلی Spark در /opt/spark را کامل حذف می‌کند. GitHub و Spark Manager حذف نمی‌شوند." "DELETE-SOURCE"; then
    warn "حذف Source لغو شد."
    return 1
  fi
  rm -rf -- "$SPARK_ROOT"
  cleanup_unmark_steps 4 8 12 13
  [[ ! -e "$SPARK_ROOT" ]] || { fail "${SPARK_ROOT} حذف نشد."; return 1; }
  ok "Spark source repository محلی حذف شد."
}

cleanup_manager_logs() {
  new_log "cleanup-logs"
  if ! confirm_word "تمام logهای Spark Manager در ${LOG_DIR} حذف می‌شوند. Journal سیستم و Docker logها دست‌کاری نمی‌شوند." "DELETE-LOGS"; then
    warn "حذف Logها لغو شد."
    return 1
  fi
  find "$LOG_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>/dev/null || true
  mkdir -p "$LOG_DIR"
  chmod 700 "$LOG_DIR"
  ok "Spark Manager logها حذف شدند."
}

cleanup_backups() {
  new_log "cleanup-backups"
  if ! confirm_word "تمام Backupهای Spark در ${BACKUP_DIR} به‌صورت غیرقابل بازگشت حذف می‌شوند." "DELETE-BACKUPS"; then
    warn "حذف Backupها لغو شد."
    return 1
  fi
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>/dev/null || true
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  ok "تمام Backupهای Spark حذف شدند."
}

cleanup_install_history() {
  new_log "cleanup-install-history"
  if ! confirm_word "History مراحل نصب پاک می‌شود. هیچ سرویس یا داده‌ای حذف نمی‌شود؛ فقط markerهای DONE پاک می‌شوند." "RESET-HISTORY"; then
    warn "Reset History لغو شد."
    return 1
  fi
  find "$STEP_DIR" -maxdepth 1 -type f -name '*.ok' -delete 2>/dev/null || true
  ok "Installation History پاک شد. وضعیت Actual همچنان از تست واقعی سرور محاسبه می‌شود."
}

cleanup_stop_schedulers_internal() {
  local unit
  set +e
  for unit in \
    spark-daily-report.timer spark-minutes-reminder.timer spark-decision-due.timer spark-notification-outbox.timer \
    spark-daily-report.service spark-minutes-reminder.service spark-decision-due.service spark-notification-outbox.service; do
    systemctl disable --now "$unit" >>"$CURRENT_LOG" 2>&1
    rm -f "/etc/systemd/system/${unit}"
  done
  systemctl daemon-reload >>"$CURRENT_LOG" 2>&1
  set -e
}

cleanup_nginx_internal() {
  rm -f \
    /etc/nginx/sites-enabled/spark \
    /etc/nginx/sites-enabled/spark-bootstrap \
    /etc/nginx/sites-enabled/spark-supabase-admin \
    /etc/nginx/sites-available/spark \
    /etc/nginx/sites-available/spark-bootstrap \
    /etc/nginx/sites-available/spark-supabase-admin
  if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then
    if nginx -t >>"$CURRENT_LOG" 2>&1; then
      systemctl reload nginx >>"$CURRENT_LOG" 2>&1 || true
    else
      warn "Nginx بعد از حذف configهای Spark خطای syntax دیگری دارد؛ reload انجام نشد."
    fi
  fi
}

cleanup_turn_internal() {
  set +e
  systemctl disable --now coturn >>"$CURRENT_LOG" 2>&1
  rm -f /etc/turnserver.conf
  rm -rf /etc/coturn/certs
  rm -f /etc/systemd/system/certbot.service.d/spark-turn.conf
  if [[ -f /etc/default/coturn ]]; then
    if grep -q '^TURNSERVER_ENABLED=' /etc/default/coturn; then
      sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=0/' /etc/default/coturn
    fi
  fi
  systemctl daemon-reload >>"$CURRENT_LOG" 2>&1
  set -e
}

cleanup_certificates_internal() {
  local cert
  command -v certbot >/dev/null 2>&1 || return 0
  for cert in "${APP_DOMAIN:-}" "${API_DOMAIN:-}" "${TURN_DOMAIN:-}"; do
    [[ -n "$cert" ]] || continue
    certbot delete --cert-name "$cert" --non-interactive >>"$CURRENT_LOG" 2>&1 || true
  done
}

cleanup_firewall_runtime_rules_internal() {
  ufw_is_active || return 0
  set +e
  ufw --force delete allow 5432/tcp >>"$CURRENT_LOG" 2>&1
  ufw --force delete allow 8443/tcp >>"$CURRENT_LOG" 2>&1
  ufw --force delete allow 3478/tcp >>"$CURRENT_LOG" 2>&1
  ufw --force delete allow 3478/udp >>"$CURRENT_LOG" 2>&1
  ufw --force delete allow 5349/tcp >>"$CURRENT_LOG" 2>&1
  if [[ -n "${TURN_MIN_PORT:-}" && -n "${TURN_MAX_PORT:-}" ]]; then
    ufw --force delete allow "${TURN_MIN_PORT}:${TURN_MAX_PORT}/udp" >>"$CURRENT_LOG" 2>&1
  fi
  set -e
}

cleanup_full_project() {
  new_log "cleanup-full-project"
  warn "این عملیات تمام اجزای Spark روی این سرور را حذف می‌کند: Source، Supabase Runtime/Data، Frontend، Spark config/secrets، Nginx config، Schedulerها، TURN config، Certificateهای دامنه‌های Spark، Backupها و Logها."
  info "Docker/Nginx/Node/Certbot packageها، SSH/HTTP/HTTPS عمومی UFW و خود Spark Manager نگه داشته می‌شوند تا امکان نصب مجدد وجود داشته باشد."
  if ! confirm_word "مرحله اول تأیید حذف کامل پروژه." "DELETE-SPARK"; then
    warn "حذف کامل پروژه لغو شد."
    return 1
  fi
  if ! confirm_word "این آخرین تأیید است؛ داده‌های Database و Backup قابل بازگشت نیستند." "CONFIRM-ALL-DATA"; then
    warn "حذف کامل پروژه لغو شد."
    return 1
  fi

  close_database_external_access >/dev/null 2>&1 || true
  close_supabase_studio_access >/dev/null 2>&1 || true
  cleanup_stop_schedulers_internal
  cleanup_turn_internal
  cleanup_nginx_internal
  cleanup_certificates_internal
  cleanup_firewall_runtime_rules_internal

  if [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]]; then
    compose down --volumes --remove-orphans >>"$CURRENT_LOG" 2>&1 || true
  fi

  rm -rf -- \
    "$SPARK_ROOT" \
    "$SUPABASE_ROOT" \
    "$SUPABASE_SOURCE" \
    /var/www/spark \
    "$CONFIG_DIR" \
    "$STATE_DIR" \
    "$LOG_DIR" \
    "$BACKUP_DIR"

  mkdir -p "$STATE_DIR" "$STEP_DIR" "$LOG_DIR" "$BACKUP_DIR" "$CONFIG_DIR"
  chmod 700 "$STATE_DIR" "$STEP_DIR" "$LOG_DIR" "$BACKUP_DIR" "$CONFIG_DIR"

  ok "تمام اجزای پروژه Spark از سرور حذف شدند. Spark Manager و packageهای مشترک سیستم باقی مانده‌اند."
  info "برای نصب مجدد، Spark Manager را باز کنید و ۱۸ مرحله نصب موجود را اجرا کنید."
}

cleanup_uninstall_manager() {
  new_log "cleanup-manager"
  if ! confirm_word "Spark Manager از /usr/local/lib/spark-manager و command /usr/local/bin/spark حذف می‌شود. پروژه/runtime دست‌کاری نمی‌شود." "UNINSTALL-MANAGER"; then
    warn "حذف Manager لغو شد."
    return 1
  fi
  rm -f "$CLI_PATH"
  rm -rf /usr/local/lib/spark-manager /usr/local/share/spark-manager
  ok "Spark Manager حذف شد. پس از پایان این Action از UI خارج شوید."
  info "برای نصب مجدد، bootstrap.sh را دوباره اجرا کنید."
}
