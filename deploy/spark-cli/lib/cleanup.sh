cleanup_unmark_steps() {
  local step
  for step in "$@"; do
    unmark_step "$step"
  done
}

cleanup_find_database_data_bind() {
  local rendered output rc
  [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] || {
    fail "docker-compose.yml not available; path Database Not recognizable." >&2
    return 1
  }
  rendered="$(mktemp)"
  if ! compose config --format json >"$rendered" 2>>"$CURRENT_LOG"; then
    rm -f "$rendered"
    fail "Compose The current cannot be analyzed; remove Database Stopped to avoid guesswork." >&2
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
    fail "Mount The database cannot be identified with certainty; Nothing was deleted." >&2
    return 1
  fi
  printf '%s\n' "$output"
}

cleanup_database_data() {
  local db_data
  new_log "cleanup-database"
  db_data="$(cleanup_find_database_data_bind)" || return 1
  info "PostgreSQL data path: ${db_data}"
  if ! confirm_word "This operation all the data PostgreSQL deletes and Supabase stops. To rebuild Runtime Must step 11 Run it again; migration Database only from the independent path spark-migrate is done." "DELETE-DATABASE"; then
    warn "delete Database canceled."
    return 1
  fi

  close_database_external_access >/dev/null 2>&1 || true
  close_supabase_studio_access >/dev/null 2>&1 || true
  run_logged "Stop Supabase before Database wipe" compose down --remove-orphans || return 1
  [[ -n "$db_data" && "$db_data" != "/" ]] || { fail "path Database It is unsafe; Delete stopped."; return 1; }
  rm -rf -- "$db_data"
  if [[ -e "$db_data" ]]; then
    fail "Database data path Not deleted."
    return 1
  fi
  cleanup_unmark_steps 11
  rm -f "${STEP_DIR}/12.ok"  # legacy marker from removed install step
  ok "Database PostgreSQL Completely deleted. Runtime is stopped; To rebuild the steps 11 and 12 run the."
}

cleanup_supabase_runtime() {
  new_log "cleanup-supabase-runtime"
  if ! confirm_word "This whole operation Runtime local Supabase including Database, Storage/runtime data, Compose config and Secretinside /opt/spark-supabase deletes." "DELETE-SUPABASE"; then
    warn "delete Supabase Runtime canceled."
    return 1
  fi

  close_database_external_access >/dev/null 2>&1 || true
  close_supabase_studio_access >/dev/null 2>&1 || true
  if [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]]; then
    compose down --volumes --remove-orphans >>"$CURRENT_LOG" 2>&1 || true
  fi
  rm -rf -- "$SUPABASE_ROOT"
  [[ ! -e "$SUPABASE_ROOT" ]] || { fail "${SUPABASE_ROOT} Not deleted."; return 1; }
  cleanup_unmark_steps 5 6 7 8 9 10 11 12
  ok "Supabase Runtime deleted. Source pin in ${SUPABASE_SOURCE} was kept."
}

cleanup_frontend_deploy() {
  new_log "cleanup-frontend"
  if ! confirm_word "This operation only Frontend deploy been in /var/www/spark deletes; Source repository remains." "DELETE-FRONTEND"; then
    warn "delete Frontend canceled."
    return 1
  fi
  rm -rf -- /var/www/spark
  cleanup_unmark_steps 13
  [[ ! -e /var/www/spark ]] || { fail "Frontend deploy Not deleted."; return 1; }
  ok "Frontend deploy deleted."
}

cleanup_spark_source() {
  new_log "cleanup-spark-source"
  if ! confirm_word "This operation Source repository local Spark in /opt/spark completely removes. GitHub and Spark Manager are not deleted." "DELETE-SOURCE"; then
    warn "delete Source canceled."
    return 1
  fi
  rm -rf -- "$SPARK_ROOT"
  cleanup_unmark_steps 4 8 12 13
  [[ ! -e "$SPARK_ROOT" ]] || { fail "${SPARK_ROOT} Not deleted."; return 1; }
  ok "Spark source repository Locally deleted."
}

cleanup_manager_logs() {
  new_log "cleanup-logs"
  if ! confirm_word "all logs Spark Manager in ${LOG_DIR} are deleted. Journal system and Docker logThey are not manipulated." "DELETE-LOGS"; then
    warn "delete Logwas canceled."
    return 1
  fi
  find "$LOG_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>/dev/null || true
  mkdir -p "$LOG_DIR"
  chmod 700 "$LOG_DIR"
  ok "Spark Manager logwere deleted."
}

cleanup_prune_backups() {
  local days="${1:-7}" candidates_file path bytes total_bytes=0 count=0
  local -a candidates=()

  [[ "$days" =~ ^[0-9]+$ ]] && (( days >= 1 && days <= 3650 )) || {
    fail "Retention Must be a number between 1 until 3650 be day."
    return 2
  }

  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  candidates_file="$(mktemp)"
  if ! python3 - "$BACKUP_DIR" "$days" >"$candidates_file" <<'PY'
import os
import sys
import time
from pathlib import Path

root = Path(sys.argv[1]).resolve()
days = int(sys.argv[2])
cutoff = time.time() - (days * 86400)

if not root.is_dir():
    raise SystemExit(0)

children = [p for p in root.iterdir() if not p.is_symlink()]
groups = [
    [p for p in children if p.is_dir()],
    [p for p in children if p.is_file() and p.match("postgres-*.dump")],
    [p for p in children if p.is_file() and p.match("storage-*.tar.gz")],
]

candidates = []
for group in groups:
    if not group:
        continue
    newest = max(group, key=lambda p: p.stat().st_mtime)
    for path in group:
        if path == newest:
            continue
        try:
            old = path.stat().st_mtime < cutoff
        except OSError:
            continue
        if old:
            candidates.append(path)

for path in sorted(candidates, key=lambda p: p.stat().st_mtime):
    raw = os.fsencode(str(path))
    sys.stdout.buffer.write(raw + b"\0")
PY
  then
    rm -f "$candidates_file"
    fail "analysis Backupfailed for styling."
    return 1
  fi

  mapfile -d '' -t candidates <"$candidates_file" || true
  rm -f "$candidates_file"

  if (( ${#candidates[@]} == 0 )); then
    ok "Backup Can be deleted with Retention ${days} The day was not found."
    info "latest Backup folder, latest PostgreSQL dump And the latest Storage archive They are always protected."
    return 0
  fi

  printf '\nBackupcan be removed (older than %s days):\n\n' "$days"
  for path in "${candidates[@]}"; do
    [[ "$path" == "$BACKUP_DIR/"* && "$path" != "$BACKUP_DIR" ]] || {
      fail "path Backup was found to be unsafe; Nothing was deleted: $path"
      return 1
    }
    bytes="$(du -sb -- "$path" 2>/dev/null | awk '{print $1}')"
    [[ "$bytes" =~ ^[0-9]+$ ]] || bytes=0
    total_bytes=$((total_bytes + bytes))
    count=$((count + 1))
    printf '  %-10s %s\n' "$(du -sh -- "$path" 2>/dev/null | awk '{print $1}')" "$path"
  done

  printf '\nnumber: %d\n' "$count"
  printf 'Free space: %s\n' "$(numfmt --to=iec-i --suffix=B "$total_bytes" 2>/dev/null || printf '%s bytes' "$total_bytes")"
  info "only Backupinside ${BACKUP_DIR} are checked; live data Supabase/PostgreSQL It cannot be manipulated."
  info "latest Backup from each group (directory, PostgreSQL dump, Storage archive) Even if it is old, it is kept."

  if ! confirm_word "BackupDelete the listed ones?" "PRUNE-BACKUPS"; then
    warn "stylization Backupwas canceled."
    return 1
  fi

  for path in "${candidates[@]}"; do
    [[ "$path" == "$BACKUP_DIR/"* && "$path" != "$BACKUP_DIR" ]] || {
      fail "path Backup It is unsafe; Delete stopped: $path"
      return 1
    }
    rm -rf -- "$path"
  done

  ok "${count} Backup The old one was deleted."
  info "Approximate freed space: $(numfmt --to=iec-i --suffix=B "$total_bytes" 2>/dev/null || printf '%s bytes' "$total_bytes")"
}

cleanup_backups() {
  local choice days
  new_log "cleanup-backups"
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"

  printf '\nBackup cleanup / free space\n\n'
  printf 'path: %s\n' "$BACKUP_DIR"
  printf 'current volume: %s\n\n' "$(du -sh -- "$BACKUP_DIR" 2>/dev/null | awk '{print $1}')"
  printf '  0) cancelled\n'
  printf '  1) Safe styling: delete Backupold ones with Retention desired\n'
  printf '  2) Remove all Backups\n\n'
  read -r -p "selection [1]: " choice
  choice="${choice:-1}"

  case "$choice" in
    0)
      warn "Cleanup canceled."
      return 1
      ;;
    1)
      read -r -p "be kept for the last few days? [7]: " days
      days="${days:-7}"
      cleanup_prune_backups "$days"
      ;;
    2)
      if ! confirm_word "all Backups Spark in ${BACKUP_DIR} They are irreversibly deleted." "DELETE-BACKUPS"; then
        warn "delete Backupwas canceled."
        return 1
      fi
      find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>/dev/null || true
      mkdir -p "$BACKUP_DIR"
      chmod 700 "$BACKUP_DIR"
      ok "all Backups Spark were deleted."
      ;;
    *)
      fail "The option is invalid."
      return 2
      ;;
  esac
}

cleanup_install_history() {
  new_log "cleanup-install-history"
  if ! confirm_word "History The installation process will be cleared. No service or data will be deleted; only markers DONE are deleted." "RESET-HISTORY"; then
    warn "Reset History canceled."
    return 1
  fi
  find "$STEP_DIR" -maxdepth 1 -type f -name '*.ok' -delete 2>/dev/null || true
  ok "Installation History cleared. status Actual It is still calculated from the actual server test."
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
      warn "Nginx After deletion configs Spark error syntax has another; reload not done."
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
  warn "This operation of all components Spark Deletes this server: Source, Supabase Runtime/Data, Frontend, Spark config/secrets, Nginx config, Schedulers, TURN config, Certificatedomains Spark, Backupha and Logs."
  info "Docker/Nginx/Node/Certbot packages, SSH/HTTP/HTTPS public UFW and himself Spark Manager are kept to allow for re-installation."
  if ! confirm_word "The first step is to confirm the complete deletion of the project." "DELETE-SPARK"; then
    warn "The complete removal of the project was cancelled."
    return 1
  fi
  if ! confirm_word "This is the last confirmation; data Database and Backup They are not returnable." "CONFIRM-ALL-DATA"; then
    warn "The complete removal of the project was cancelled."
    return 1
  fi

  close_database_external_access >/dev/null 2>&1 || true
  close_supabase_studio_access >/dev/null 2>&1 || true
  cleanup_stop_schedulers_internal
  if declare -F livekit_cleanup_internal >/dev/null 2>&1; then livekit_cleanup_internal; fi
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

  ok "All project components Spark They were removed from the server. Spark Manager and packageThe common ones of the system remain."
  info "To reinstall, Spark Manager Open and 21 Installation step Spark + LiveKit run the."
}

cleanup_uninstall_manager() {
  new_log "cleanup-manager"
  if ! confirm_word "Spark Manager from /usr/local/lib/spark-manager and command /usr/local/bin/spark is deleted. project/runtime It cannot be manipulated." "UNINSTALL-MANAGER"; then
    warn "delete Manager canceled."
    return 1
  fi
  rm -f "$CLI_PATH"
  rm -rf /usr/local/lib/spark-manager /usr/local/share/spark-manager
  ok "Spark Manager deleted. After this is over Action from UI get out."
  info "To reinstall, bootstrap.sh Run it again."
}
