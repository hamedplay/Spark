test_frontend() {
  curl -fIsS --connect-timeout 8 "https://${APP_DOMAIN}" || return 1
}

test_api() {
  curl -fsS --connect-timeout 8 "https://${API_DOMAIN}/auth/v1/health" || return 1
  printf '\n'
  curl -isS --connect-timeout 8 "https://${API_DOMAIN}/functions/v1/password-login" | sed -n '1,30p' || return 1
}

test_db_exposure() {
  local sockets db_public=0 db_managed=0
  sockets="$(ss -lntp)" || return 1

  if grep -Eq '0\.0\.0\.0:(5433|6543|8000|9000)\b|\[::\]:(5433|6543|8000|9000)\b' <<<"$sockets"; then
    echo "ERROR: internal Supabase port 5433/6543/8000/9000 is publicly bound"
    grep -E ':(5433|6543|8000|9000)\b' <<<"$sockets" || true
    return 1
  fi

  grep -Eq '0\.0\.0\.0:5432\b|\[::\]:5432\b|\*:5432\b' <<<"$sockets" && db_public=1
  systemctl is-active --quiet spark-db-access.socket 2>/dev/null && db_managed=1

  if (( db_public )); then
    if (( db_managed )); then
      echo "Database 5432: MANAGED OPEN (spark-db-access.socket)"
    else
      echo "ERROR: TCP/5432 is publicly bound outside Spark managed access"
      grep -E ':5432\b' <<<"$sockets" || true
      return 1
    fi
  else
    echo "Database 5432: CLOSED"
  fi

  if studio_external_is_open 2>/dev/null; then
    echo "Supabase Studio 8443: MANAGED OPEN"
  else
    echo "Supabase Studio 8443: CLOSED"
  fi
  echo "Internal Supabase ports 5433/6543/8000/9000: PRIVATE"
}

test_ssl_dns() {
  test_dns || return 1
  certbot certificates || return 1
  openssl s_client -connect "${APP_DOMAIN}:443" -servername "$APP_DOMAIN" </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates || return 1
  openssl s_client -connect "${API_DOMAIN}:443" -servername "$API_DOMAIN" </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates || return 1
}

test_full_validation() {
  require_manager_values || return 1
  echo "== Supabase local =="
  curl -fsS http://127.0.0.1:8000/auth/v1/health || return 1
  echo
  echo "== Frontend =="
  curl -fIsS "https://${APP_DOMAIN}" || return 1
  echo "== API =="
  curl -fsS "https://${API_DOMAIN}/auth/v1/health" || return 1
  echo
  curl -isS "https://${API_DOMAIN}/functions/v1/password-login" | sed -n '1,40p' || return 1
  echo "== Docker =="
  compose ps || return 1
  echo "== Scheduler =="
  test_schedulers || return 1
  echo "== TURN =="
  ss -lntup | grep -E ':(3478|5349)\b' || return 1
  turnutils_stunclient "$TURN_DOMAIN" -p 3478 || return 1
  echo "== DB / Studio exposure =="
  test_db_exposure || return 1
}

docker_logs_menu() {
  new_log "logs-docker"
  if [[ ! -f "${SUPABASE_ROOT}/docker-compose.yml" ]]; then
    fail "Supabase compose پیدا نشد."
    pause
    return
  fi
  local services service
  mapfile -t services < <(compose config --services)
  title
  printf 'Docker services:\n\n'
  printf '%s\n' "${services[@]}"
  printf '\n'
  read -r -p "نام service برای نمایش 200 خط log (Enter=بازگشت): " service
  [[ -z "$service" ]] && return
  if ! printf '%s\n' "${services[@]}" | grep -Fxq "$service"; then
    fail "Service نامعتبر."
    pause
    return
  fi
  run_report "Logs: ${service}" compose logs --tail=200 --timestamps "$service"
  pause
}

scheduler_logs() {
  new_log "logs-schedulers"
  local s
  for s in spark-daily-report spark-minutes-reminder spark-decision-due spark-notification-outbox; do
    printf '\n=== %s ===\n' "$s" | tee -a "$CURRENT_LOG"
    journalctl -u "${s}.service" -n 80 --no-pager 2>&1 | tee -a "$CURRENT_LOG" || true
  done
}

test_menu() {
  while true; do
    title
    printf '%sمنوی تست و لاگ%s\n\n' "$C_BOLD" "$C_RESET"
    printf ' 0) بازگشت\n'
    printf ' 1) Validation کامل سامانه\n'
    printf ' 2) وضعیت مراحل نصب 02 تا 20\n'
    printf ' 3) تست Frontend\n'
    printf ' 4) تست API / Auth / Function route\n'
    printf ' 5) Docker status\n'
    printf ' 6) Docker service logs\n'
    printf ' 7) Nginx status و logs\n'
    printf ' 8) Scheduler status و logs\n'
    printf ' 9) TURN status و logs\n'
    printf '10) DB/API public exposure check\n'
    printf '11) DNS و SSL\n'
    printf '12) Listening ports + UFW\n'
    printf '13) Migration dry-run\n\n'
    read -r -p "انتخاب: " choice
    case "$choice" in
      0) return ;;
      1) new_log "test-full"; run_visible "Validation کامل" test_full_validation || true; pause ;;
      2) new_log "installation-status"; installation_status_report; pause ;;
      3) new_log "test-frontend"; run_visible "Frontend" test_frontend || true; pause ;;
      4) new_log "test-api"; run_visible "API" test_api || true; pause ;;
      5) new_log "test-docker"; run_visible "Docker status" compose ps || true; pause ;;
      6) docker_logs_menu ;;
      7)
        new_log "test-nginx"
        run_report "Nginx status" systemctl status nginx --no-pager
        journalctl -u nginx -n 120 --no-pager 2>&1 | tee -a "$CURRENT_LOG" || true
        pause ;;
      8) new_log "test-schedulers"; run_report "Scheduler status" test_schedulers; scheduler_logs; pause ;;
      9)
        new_log "test-turn"
        run_report "TURN test" test_turn
        journalctl -u coturn -n 120 --no-pager 2>&1 | tee -a "$CURRENT_LOG" || true
        pause ;;
      10) new_log "test-exposure"; run_visible "Public exposure check" test_db_exposure || true; pause ;;
      11) new_log "test-dns-ssl"; run_visible "DNS/SSL" test_ssl_dns || true; pause ;;
      12)
        new_log "test-ports-firewall"
        run_report "Listening ports" ss -lntup
        run_report "UFW" ufw status verbose
        pause ;;
      13) new_log "test-migration-dryrun"; run_visible "Migration dry-run" migration_dry_run "$SPARK_ROOT" || true; pause ;;
      *) fail "گزینه نامعتبر"; sleep 1 ;;
    esac
  done
}

create_backup() {
  local kind="${1:-manual}" stamp dest
  stamp="$(date +%Y%m%d-%H%M%S)"
  dest="${BACKUP_DIR}/${kind}-${stamp}"
  mkdir -p "$dest"
  chmod 700 "$dest"
  echo "$dest" >"${STATE_DIR}/last-backup-path"
  if [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] && compose config --services | grep -Fxq db; then
    info "Backup PostgreSQL..." >&2
    compose exec -T db pg_dump -U postgres -d postgres -Fc >"${dest}/postgres.dump"
    chmod 600 "${dest}/postgres.dump"
  fi
  mkdir -p "${dest}/config"
  [[ -f "${SUPABASE_ROOT}/.env" ]] && cp -a "${SUPABASE_ROOT}/.env" "${dest}/config/supabase.env"
  [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] && cp -a "${SUPABASE_ROOT}/docker-compose.yml" "${dest}/config/docker-compose.yml"
  [[ -d "$CONFIG_DIR" ]] && tar -C / -czf "${dest}/config/etc-spark.tar.gz" etc/spark
  [[ -f /etc/nginx/sites-available/spark ]] && cp -a /etc/nginx/sites-available/spark "${dest}/config/nginx-spark"
  [[ -f /etc/turnserver.conf ]] && cp -a /etc/turnserver.conf "${dest}/config/turnserver.conf"
  chmod -R go-rwx "$dest"
  printf '%s\n' "$dest"
}

list_backups() {
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%TY-%Tm-%Td %TH:%TM  %p\n' | sort -r | head -n 50
}

backup_menu() {
  while true; do
    title
    printf '%sBackup Management%s\n\n' "$C_BOLD" "$C_RESET"
    printf '0) بازگشت\n1) ایجاد Backup دستی DB + config\n2) لیست Backupها\n\n'
    read -r -p "انتخاب: " c
    case "$c" in
      0) return ;;
      1)
        new_log "backup-manual"
        if run_visible "ایجاد Backup" create_backup manual; then ok "Backup ساخته شد."; fi
        pause ;;
      2) new_log "backup-list"; run_report "Backupها" list_backups; pause ;;
      *) fail "گزینه نامعتبر"; sleep 1 ;;
    esac
  done
}
