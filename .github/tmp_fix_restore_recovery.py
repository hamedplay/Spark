from pathlib import Path

p = Path('deploy/spark-cli/lib/tests-backup.sh')
s = p.read_text(encoding='utf-8')

needle = '''restore_restart_supabase_stack() {
  compose up -d
}

restore_terminate_postgres_sessions() {
'''
replacement = '''restore_restart_supabase_stack() {
  compose up -d
}

restore_wait_postgres_writable() {
  local timeout_seconds="${1:-180}" started now state
  started="$(date +%s)"
  while true; do
    state="$(compose exec -T db psql -X -U postgres -d template1 -Atqc \
      "SELECT CASE WHEN pg_is_in_recovery() THEN 'recovery' ELSE 'ready' END;" 2>/dev/null || true)"
    if [[ "$state" == 'ready' ]]; then
      return 0
    fi
    now="$(date +%s)"
    if (( now - started >= timeout_seconds )); then
      fail "PostgreSQL did not become writable within ${timeout_seconds}s (state=${state:-unavailable})."
      return 1
    fi
    sleep 2
  done
}

restore_ensure_db_writable() {
  compose up -d db >/dev/null 2>&1 || return 1
  restore_wait_postgres_writable "${1:-180}"
}

restore_terminate_postgres_sessions() {
  restore_ensure_db_writable 180 || return 1
'''
if needle not in s:
    raise SystemExit('restart/terminate marker not found')
s = s.replace(needle, replacement, 1)

needle = '''restore_create_postgres_database() {
  compose exec -T db psql -X -U postgres -d template1 -v ON_ERROR_STOP=1 -c \\
    'CREATE DATABASE postgres WITH OWNER postgres TEMPLATE template0 ENCODING '\\''UTF8'\\'';'
}
'''
replacement = '''restore_create_postgres_database() {
  restore_ensure_db_writable 180 || return 1
  compose exec -T db psql -X -U postgres -d template1 -v ON_ERROR_STOP=1 -c \\
    'CREATE DATABASE postgres WITH OWNER postgres TEMPLATE template0 ENCODING '\\''UTF8'\\'';'
}
'''
if needle not in s:
    raise SystemExit('create database marker not found')
s = s.replace(needle, replacement, 1)

needle = '''restore_apply_plain_dump() {
  local path="$1"
  if plain_backup_has_create_database "$path"; then
'''
replacement = '''restore_apply_plain_dump() {
  local path="$1"
  restore_ensure_db_writable 180 || return 1
  if plain_backup_has_create_database "$path"; then
'''
if needle not in s:
    raise SystemExit('apply dump marker not found')
s = s.replace(needle, replacement, 1)

needle = '''restore_custom_safety_dump() {
  local dump="$1"
  [[ -s "$dump" ]] || return 1
  restore_drop_postgres_database || return 1
  restore_create_postgres_database || return 1
  compose exec -T db pg_restore -U postgres -d postgres --exit-on-error <"$dump"
}
'''
replacement = '''restore_custom_safety_dump() {
  local dump="$1"
  [[ -s "$dump" ]] || return 1
  restore_ensure_db_writable 180 || return 1
  restore_drop_postgres_database || return 1
  restore_create_postgres_database || return 1
  restore_wait_postgres_writable 180 || return 1
  compose exec -T db pg_restore -U postgres -d postgres --exit-on-error <"$dump"
}
'''
if needle not in s:
    raise SystemExit('safety dump marker not found')
s = s.replace(needle, replacement, 1)

needle = '''  info "Stopping Supabase writers while keeping PostgreSQL online..."
  if ! restore_stop_non_db_services; then
    fail "Unable to stop non-database Supabase services."
    (( db_access_was_active )) && systemctl start spark-db-access.socket >/dev/null 2>&1 || true
    return 1
  fi

  info "Replacing database from plain SQL backup. psql will stop on the first SQL error."
'''
replacement = '''  info "Stopping Supabase writers while keeping PostgreSQL online..."
  if ! restore_stop_non_db_services; then
    fail "Unable to stop non-database Supabase services."
    (( db_access_was_active )) && systemctl start spark-db-access.socket >/dev/null 2>&1 || true
    return 1
  fi
  info "Waiting for PostgreSQL to be writable before restore..."
  if ! restore_ensure_db_writable 180; then
    fail "PostgreSQL is not writable; restore was not started."
    (( db_access_was_active )) && systemctl start spark-db-access.socket >/dev/null 2>&1 || true
    return 1
  fi

  info "Replacing database from plain SQL backup. psql will stop on the first SQL error."
'''
if needle not in s:
    raise SystemExit('pre-restore marker not found')
s = s.replace(needle, replacement, 1)

needle = '''  if (( restore_rc != 0 )); then
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
'''
replacement = '''  if (( restore_rc != 0 )); then
    warn "Restore failed. Waiting for PostgreSQL recovery to finish before automatic rollback."
    set +e
    restore_ensure_db_writable 180 >>"${CURRENT_LOG:-/dev/null}" 2>&1
    rollback_rc=$?
    if (( rollback_rc == 0 )); then
      restore_custom_safety_dump "$safety_dump" >>"${CURRENT_LOG:-/dev/null}" 2>&1
      rollback_rc=$?
    fi
    set -e
    (( db_access_was_active )) && systemctl start spark-db-access.socket >/dev/null 2>&1 || true
    if (( rollback_rc == 0 )); then
      restore_restart_supabase_stack >>"${CURRENT_LOG:-/dev/null}" 2>&1 || true
      fail "Plain backup restore failed; the previous database was restored automatically. Safety backup: $safety_dir"
    else
      # Keep application writers stopped. Only PostgreSQL remains available for recovery work.
      restore_stop_non_db_services >>"${CURRENT_LOG:-/dev/null}" 2>&1 || true
      fail "Plain backup restore failed and automatic rollback also failed. Non-database Supabase services remain stopped to prevent writes. Safety backup: $safety_dir"
    fi
    return 1
  fi
'''
if needle not in s:
    raise SystemExit('rollback marker not found')
s = s.replace(needle, replacement, 1)

# Avoid head|grep under pipefail for large files/SIGPIPE edge cases.
needle = '''  if ! head -n 120 "$path" | grep -Fq -- '-- PostgreSQL database dump'; then
    fail "The file does not look like a plain PostgreSQL pg_dump."
    return 1
  fi
'''
replacement = '''  if ! sed -n '1,120p' "$path" | grep -Fq -- '-- PostgreSQL database dump'; then
    fail "The file does not look like a plain PostgreSQL pg_dump."
    return 1
  fi
'''
if needle not in s:
    raise SystemExit('plain validation marker not found')
s = s.replace(needle, replacement, 1)

p.write_text(s, encoding='utf-8')
print('restore recovery patch applied')
