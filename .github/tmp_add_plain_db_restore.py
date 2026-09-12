from pathlib import Path

# 1) Backend restore implementation.
p = Path('deploy/spark-cli/lib/tests-backup.sh')
s = p.read_text(encoding='utf-8')
marker = '''list_backups() {
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%TY-%Tm-%Td %TH:%TM  %p\\n' | sort -r | head -n 50
}
'''
if marker not in s:
    raise SystemExit('tests-backup marker not found')
insert = r'''
plain_backup_validate() {
  local path="$1" magic
  [[ -f "$path" && -r "$path" && -s "$path" ]] || {
    fail "Backup file is missing, unreadable or empty: $path"
    return 1
  }
  magic="$(head -c 5 "$path" 2>/dev/null || true)"
  if [[ "$magic" == "PGDMP" ]]; then
    fail "This is a PostgreSQL custom-format dump. This restore action accepts only plain SQL pg_dump files."
    return 1
  fi
  if ! head -n 120 "$path" | grep -Fq -- '-- PostgreSQL database dump'; then
    fail "The file does not look like a plain PostgreSQL pg_dump."
    return 1
  fi

  local line
  while IFS= read -r line; do
    [[ "$line" =~ ^CREATE[[:space:]]+DATABASE[[:space:]]+(\"?postgres\"?)([[:space:];]|$) ]] || {
      fail "The dump attempts to create a database other than postgres: $line"
      return 1
    }
  done < <(grep -a -E '^CREATE[[:space:]]+DATABASE[[:space:]]+' "$path" || true)
}

plain_backup_has_create_database() {
  grep -a -Eq '^CREATE[[:space:]]+DATABASE[[:space:]]+\"?postgres\"?([[:space:];]|$)' "$1"
}

plain_backup_has_drop_database() {
  grep -a -Eq '^DROP[[:space:]]+DATABASE([[:space:]]+IF[[:space:]]+EXISTS)?[[:space:]]+\"?postgres\"?([[:space:];]|$)' "$1"
}

restore_stop_non_db_services() {
  local -a services=()
  mapfile -t services < <(compose config --services | grep -v '^db$' || true)
  if (( ${#services[@]} )); then
    compose stop "${services[@]}"
  fi
}

restore_restart_supabase_stack() {
  compose up -d
}

restore_terminate_postgres_sessions() {
  compose exec -T db psql -X -U postgres -d template1 -v ON_ERROR_STOP=1 -Atqc \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres' AND pid <> pg_backend_pid();" >/dev/null
}

restore_drop_postgres_database() {
  restore_terminate_postgres_sessions || return 1
  compose exec -T db psql -X -U postgres -d template1 -v ON_ERROR_STOP=1 -c \
    'DROP DATABASE IF EXISTS postgres WITH (FORCE);'
}

restore_create_postgres_database() {
  compose exec -T db psql -X -U postgres -d template1 -v ON_ERROR_STOP=1 -c \
    'CREATE DATABASE postgres WITH OWNER postgres TEMPLATE template0 ENCODING '\''UTF8'\'';'
}

restore_apply_plain_dump() {
  local path="$1"
  if plain_backup_has_create_database "$path"; then
    if ! plain_backup_has_drop_database "$path"; then
      restore_drop_postgres_database || return 1
    else
      restore_terminate_postgres_sessions || return 1
    fi
    compose exec -T db psql -X -U postgres -d template1 -v ON_ERROR_STOP=1 <"$path"
  else
    restore_drop_postgres_database || return 1
    restore_create_postgres_database || return 1
    compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$path"
  fi
}

restore_validate_database() {
  local result
  result="$(compose exec -T db psql -X -U postgres -d postgres -Atqc \
    "SELECT current_database() || '|' || (to_regnamespace('public') IS NOT NULL)::int || '|' || (to_regnamespace('auth') IS NOT NULL)::int || '|' || (to_regnamespace('storage') IS NOT NULL)::int;" 2>/dev/null || true)"
  [[ "$result" == 'postgres|1|1|1' ]] || {
    fail "Restored database validation failed. Expected postgres with public/auth/storage schemas, got: ${result:-<no result>}"
    return 1
  }
}

restore_custom_safety_dump() {
  local dump="$1"
  [[ -s "$dump" ]] || return 1
  restore_drop_postgres_database || return 1
  restore_create_postgres_database || return 1
  compose exec -T db pg_restore -U postgres -d postgres --exit-on-error <"$dump"
}

restore_plain_database_from_file() {
  local path="$1" safety_dir safety_dump db_access_was_active=0 restore_rc=0 rollback_rc=0
  plain_backup_validate "$path" || return 1
  [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] || {
    fail "Supabase runtime is not installed at ${SUPABASE_ROOT}."
    return 1
  }
  compose config --services | grep -Fxq db || {
    fail "Supabase Compose does not contain the db service."
    return 1
  }
  compose ps --status running --services | grep -Fxq db || {
    fail "Supabase database container is not running."
    return 1
  }

  info "Creating mandatory safety backup before replacing the postgres database..."
  safety_dir="$(create_backup pre-restore)" || {
    fail "Safety backup failed. Restore was not started."
    return 1
  }
  safety_dump="${safety_dir}/postgres.dump"
  [[ -s "$safety_dump" ]] || {
    fail "Safety backup does not contain postgres.dump. Restore was not started."
    return 1
  }
  printf 'Safety backup : %s\n' "$safety_dir"

  if systemctl is-active --quiet spark-db-access.socket 2>/dev/null; then
    db_access_was_active=1
    systemctl stop spark-db-access.socket >/dev/null 2>&1 || true
  fi

  info "Stopping Supabase writers while keeping PostgreSQL online..."
  if ! restore_stop_non_db_services; then
    fail "Unable to stop non-database Supabase services."
    (( db_access_was_active )) && systemctl start spark-db-access.socket >/dev/null 2>&1 || true
    return 1
  fi

  info "Replacing database from plain SQL backup. psql will stop on the first SQL error."
  set +e
  restore_apply_plain_dump "$path" >>"${CURRENT_LOG:-/dev/null}" 2>&1
  restore_rc=$?
  set -e

  if (( restore_rc == 0 )); then
    if ! restore_validate_database >>"${CURRENT_LOG:-/dev/null}" 2>&1; then
      restore_rc=1
    fi
  fi

  if (( restore_rc != 0 )); then
    warn "Restore failed. Automatically rolling back to the pre-restore safety backup."
    set +e
    restore_custom_safety_dump "$safety_dump" >>"${CURRENT_LOG:-/dev/null}" 2>&1
    rollback_rc=$?
    set -e
    restore_restart_supabase_stack >>"${CURRENT_LOG:-/dev/null}" 2>&1 || true
    (( db_access_was_active )) && systemctl start spark-db-access.socket >/dev/null 2>&1 || true
    if (( rollback_rc == 0 )); then
      fail "Plain backup restore failed; the previous database was restored automatically. Safety backup: $safety_dir"
    else
      fail "Plain backup restore failed and automatic rollback also failed. Do not continue application traffic. Safety backup: $safety_dir"
    fi
    return 1
  fi

  if ! restore_restart_supabase_stack >>"${CURRENT_LOG:-/dev/null}" 2>&1; then
    fail "Database restore succeeded but the Supabase stack did not restart cleanly. Database data is preserved."
    (( db_access_was_active )) && systemctl start spark-db-access.socket >/dev/null 2>&1 || true
    return 1
  fi
  (( db_access_was_active )) && systemctl start spark-db-access.socket >/dev/null 2>&1 || true

  # Step 21 contains DB/RPC/Edge Function integration validation and must be
  # re-run against the newly restored application database.
  unmark_step 21 2>/dev/null || rm -f "${STEP_DIR}/21.ok" 2>/dev/null || true

  ok "PostgreSQL plain backup restore completed and Supabase was restarted."
  printf 'Source backup : %s\n' "$path"
  printf 'Safety backup : %s\n' "$safety_dir"
  info "Run Installation Air-Gapped -> Step 21 again to validate DB/RPC/Edge Function integration."
}

restore_plain_database_interactive() {
  local path confirmation bytes
  printf '\n%s%sRestore PostgreSQL from plain backup%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
  printf '%s\n' '────────────────────────────────────────────────────────────'
  printf 'This operation REPLACES the postgres database.\n'
  printf 'A mandatory safety backup is created automatically before any destructive action.\n'
  printf 'Only plain SQL output from pg_dump/pgAdmin Plain format is accepted.\n\n'
  read -r -p 'Plain backup path (example /root/db.backup): ' path
  [[ -n "$path" ]] || { fail "Backup path is required."; return 1; }
  plain_backup_validate "$path" || return 1
  bytes="$(stat -c '%s' "$path" 2>/dev/null || printf '0')"
  printf 'File : %s\nSize : %s bytes\n' "$path" "$bytes"
  read -r -p 'Type RESTORE to replace the database: ' confirmation
  [[ "$confirmation" == 'RESTORE' ]] || { warn "Restore canceled."; return 1; }
  restore_plain_database_from_file "$path"
}

'''
s = s.replace(marker, insert + marker, 1)
p.write_text(s, encoding='utf-8')

# 2) Backend dispatch action.
p = Path('deploy/spark-cli/spark')
s = p.read_text(encoding='utf-8')
marker = '''    backup-create)
      new_log "backup-manual"
      run_visible "Create DB + config backup" create_backup manual
      ;;
    backup-list) new_log "backup-list"; run_report "Backups" list_backups ;;
'''
replacement = '''    backup-create)
      new_log "backup-manual"
      run_visible "Create DB + config backup" create_backup manual
      ;;
    backup-restore-plain)
      new_log "database-restore-plain"
      restore_plain_database_interactive
      ;;
    backup-list) new_log "backup-list"; run_report "Backups" list_backups ;;
'''
if marker not in s:
    raise SystemExit('spark backup dispatch marker not found')
s = s.replace(marker, replacement, 1)
p.write_text(s, encoding='utf-8')

# 3) UI action under Backups + self-test registration.
p = Path('deploy/spark-cli/spark-ui.py')
s = p.read_text(encoding='utf-8')
marker = '''        elif category == "Backups":
            idx = next((i for i, a in enumerate(new_actions) if a.special == "logs"), len(new_actions))
            new_actions.insert(idx, core.Action(
                "cleanup-backups",
                "Backup cleanup / free space",
                "Prune old Spark backups with configurable retention while protecting the newest recovery point of each known backup type.",
                "confirm",
            ))
'''
replacement = '''        elif category == "Backups":
            idx = next((i for i, a in enumerate(new_actions) if a.special == "logs"), len(new_actions))
            new_actions.insert(idx, core.Action(
                "backup-restore-plain",
                "Restore PostgreSQL from plain backup",
                "Replace the postgres database from a full pg_dump/pgAdmin Plain SQL backup. A safety backup is created first and rollback is automatic on restore failure.",
                "confirm",
            ))
            idx = next((i for i, a in enumerate(new_actions) if a.special == "logs"), len(new_actions))
            new_actions.insert(idx, core.Action(
                "cleanup-backups",
                "Backup cleanup / free space",
                "Prune old Spark backups with configurable retention while protecting the newest recovery point of each known backup type.",
                "confirm",
            ))
'''
if marker not in s:
    raise SystemExit('spark-ui Backups marker not found')
s = s.replace(marker, replacement, 1)
required_marker = '        "cleanup-backups",\n'
if required_marker not in s:
    raise SystemExit('spark-ui required marker not found')
s = s.replace(required_marker, '        "backup-restore-plain",\n' + required_marker, 1)
p.write_text(s, encoding='utf-8')

for path in (
    'deploy/spark-cli/lib/tests-backup.sh',
    'deploy/spark-cli/spark',
):
    if 'backup-restore-plain' not in Path(path).read_text(encoding='utf-8') and path.endswith('/spark'):
        raise SystemExit(f'missing action marker in {path}')
print('Plain database restore patch applied')
