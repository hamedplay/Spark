#!/usr/bin/env bash
# Spark database-layer operations.
# This module intentionally owns schema/RPC migrations and does not update the
# frontend application or the Supabase Docker/runtime version.

spark_database_pending_migrations() {
  local migrations_dir="${SPARK_ROOT}/supabase/migrations"
  local latest_applied file base version

  [[ -d "$migrations_dir" ]] || {
    fail "Migration directory not found: ${migrations_dir}"
    return 1
  }
  [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] || {
    fail "Supabase compose file not found: ${SUPABASE_ROOT}/docker-compose.yml"
    return 1
  }

  if ! latest_applied="$(compose exec -T db psql -X -U postgres -d postgres -Atqc \
    "select coalesce(max(version), '00000000000000') from supabase_migrations.schema_migrations where version ~ '^[0-9]{14}$'" \
    2>>"${CURRENT_LOG}")"; then
    fail "Unable to read Supabase migration history."
    return 1
  fi
  latest_applied="${latest_applied//$'\r'/}"
  [[ "$latest_applied" =~ ^[0-9]{14}$ ]] || {
    fail "Invalid latest migration version returned by database: ${latest_applied}"
    return 1
  }

  while IFS= read -r file; do
    base="$(basename "$file")"
    version="${base%%_*}"
    [[ "$version" =~ ^[0-9]{14}$ ]] || continue
    if [[ "$version" > "$latest_applied" ]]; then
      printf '%s\n' "$file"
    fi
  done < <(find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' -print | sort)
}

spark_database_apply_migration_file() {
  local file="$1" base version name
  base="$(basename "$file")"
  version="${base%%_*}"
  name="${base#*_}"
  name="${name%.sql}"

  [[ "$version" =~ ^[0-9]{14}$ ]] || {
    fail "Invalid migration filename: ${base}"
    return 1
  }
  [[ "$name" =~ ^[A-Za-z0-9_]+$ ]] || {
    fail "Unsafe migration name: ${base}"
    return 1
  }

  # Spark migrations are expected to be transaction-safe. Refuse constructs
  # that cannot be safely wrapped with the migration-history write.
  if grep -Eiq '^[[:space:]]*(BEGIN|START[[:space:]]+TRANSACTION|COMMIT|ROLLBACK)[[:space:]]*;|CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX[[:space:]]+CONCURRENTLY|^[[:space:]]*VACUUM\b' "$file"; then
    fail "Migration ${base} contains transaction-sensitive SQL; refusing automatic apply."
    return 1
  fi

  {
    printf 'BEGIN;\n'
    cat "$file"
    printf '\nINSERT INTO supabase_migrations.schema_migrations(version, name) VALUES (%s, %s) ON CONFLICT (version) DO NOTHING;\n' \
      "'${version}'" "'${name}'"
    printf "NOTIFY pgrst, 'reload schema';\n"
    printf 'COMMIT;\n'
  } | compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
      >>"${CURRENT_LOG}" 2>&1
}

spark_database_update_supabase() {
  title
  new_log "database-update-supabase"

  require_dir "${SPARK_ROOT}/.git" || return 1
  require_dir "${SPARK_ROOT}/supabase/migrations" || return 1
  require_file "${SUPABASE_ROOT}/docker-compose.yml" || return 1

  if ! run_logged "Check PostgreSQL" \
    compose exec -T db psql -X -U postgres -d postgres -Atqc 'select 1'; then
    return 1
  fi

  local pending=() file base total current=0 pending_file
  pending_file="$(mktemp)"
  if ! spark_database_pending_migrations >"$pending_file"; then
    rm -f "$pending_file"
    fail "Unable to determine pending migrations; database update stopped."
    return 1
  fi
  mapfile -t pending <"$pending_file"
  rm -f "$pending_file"
  total="${#pending[@]}"

  if (( total == 0 )); then
    ok "Database schema is already current."
    return 0
  fi

  info "Pending forward migrations: ${total}"
  for file in "${pending[@]}"; do
    current=$((current + 1))
    base="$(basename "$file")"
    info "[${current}/${total}] ${base}"
    if ! run_logged "Apply ${base}" spark_database_apply_migration_file "$file"; then
      fail "Database update stopped at ${base}. Later migrations were not attempted."
      return 1
    fi
  done

  if ! run_logged "Reload PostgREST schema cache" \
    compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -c "NOTIFY pgrst, 'reload schema';"; then
    return 1
  fi

  local remaining_file
  remaining_file="$(mktemp)"
  if ! spark_database_pending_migrations >"$remaining_file"; then
    rm -f "$remaining_file"
    fail "Post-update migration validation could not read migration history."
    return 1
  fi
  if [[ -s "$remaining_file" ]]; then
    cat "$remaining_file" >>"${CURRENT_LOG}"
    rm -f "$remaining_file"
    fail "Migration validation failed: forward migrations are still pending."
    return 1
  fi
  rm -f "$remaining_file"

  ok "Supabase database schema updated successfully."
  printf 'Applied migrations: %d\n' "$total"
  printf 'Log: %s\n' "$CURRENT_LOG"
}
