#!/usr/bin/env bash
# Spark database-layer operations.
# This module intentionally owns schema/RPC migrations and does not update the
# frontend application or the Supabase Docker/runtime version.
#
# Canonical rule: every Spark operational SQL migration belongs under
# /opt/spark/supabase/migrations. No deploy/spark-cli repair SQL fallback exists.
SPARK_MIGRATIONS_DIR="${SPARK_ROOT}/supabase/migrations"

spark_database_pending_migrations() {
  local migrations_dir="$SPARK_MIGRATIONS_DIR"
  local latest_applied file base version

  # The repository may legitimately contain no migrations yet. Once a migration
  # is added, this canonical directory is the only supported source.
  [[ -d "$migrations_dir" ]] || return 0
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
  local file="$1" base version name file_dir canonical_dir
  file_dir="$(realpath -m "$(dirname "$file")")"
  canonical_dir="$(realpath -m "$SPARK_MIGRATIONS_DIR")"
  if [[ "$file_dir" != "$canonical_dir" ]]; then
    fail "Refusing SQL outside canonical migration directory: $file"
    return 1
  fi

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
  new_log "supabase-runtime-update"

  require_dir "${SUPABASE_SOURCE}/.git" || return 1
  require_file "${SUPABASE_ROOT}/docker-compose.yml" || return 1
  require_file "${SUPABASE_ROOT}/.env" || return 1

  if [[ -n "$(git -C "$SUPABASE_SOURCE" status --porcelain)" ]]; then
    fail "Supabase source has uncommitted changes; runtime update stopped."
    git -C "$SUPABASE_SOURCE" status --short | tee -a "$CURRENT_LOG"
    return 1
  fi

  local current_ref latest_ref current_commit backup_dir old_source_commit
  current_ref="$(spark_supabase_runtime_ref 2>/dev/null || true)"
  old_source_commit="$(git -C "$SUPABASE_SOURCE" rev-parse HEAD)" || return 1

  run_logged "Fetch latest stable Supabase releases" \
    git -C "$SUPABASE_SOURCE" fetch origin --tags --prune || return 1

  latest_ref="$(spark_supabase_stable_ref_from_source)"
  [[ "$latest_ref" =~ ^self-hosted/v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    fail "Unable to resolve latest stable Supabase self-hosted release."
    return 1
  }

  info "Current Supabase runtime: ${current_ref:-unknown}"
  info "Latest stable release    : $latest_ref"

  if [[ "$current_ref" == "$latest_ref" ]]; then
    ok "Supabase runtime is already on the latest stable release."
    return 0
  fi

  backup_dir="/var/backups/spark/supabase-runtime-update-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$backup_dir"
  cp -a "${SUPABASE_ROOT}/.env" "$backup_dir/.env" || return 1
  cp -a "${SUPABASE_ROOT}/docker-compose.yml" "$backup_dir/docker-compose.yml" || return 1
  [[ -f "${SUPABASE_ROOT}/.supabase-version" ]] && cp -a "${SUPABASE_ROOT}/.supabase-version" "$backup_dir/.supabase-version" || true
  tar -C "$SUPABASE_ROOT" \
    --exclude='./volumes/db/data' \
    --exclude='./volumes/storage' \
    --exclude='./volumes/functions' \
    -czf "$backup_dir/runtime-config.tgz" . >>"$CURRENT_LOG" 2>&1 || {
      fail "Unable to create Supabase runtime configuration backup."
      return 1
    }

  run_logged "Checkout latest stable Supabase $latest_ref" \
    git -C "$SUPABASE_SOURCE" checkout --detach "$latest_ref" || return 1

  if ! run_logged "Validate latest Supabase Docker snapshot" \
    bash -c "cd '${SUPABASE_SOURCE}/docker' && docker compose --env-file .env.example -f docker-compose.yml config --quiet"; then
    git -C "$SUPABASE_SOURCE" checkout --detach "$old_source_commit" >/dev/null 2>&1 || true
    return 1
  fi

  current_commit="$(git -C "$SUPABASE_SOURCE" rev-parse HEAD)" || return 1

  # Stop API/runtime services while preserving the PostgreSQL container and data.
  run_logged "Stop Supabase API/runtime services" bash -c \
    "cd '$SUPABASE_ROOT' && docker compose stop functions api-gw auth rest realtime storage supavisor studio vector imgproxy 2>/dev/null || true"

  if ! run_logged "Install latest Supabase runtime snapshot" \
    cp -a "${SUPABASE_SOURCE}/docker/." "$SUPABASE_ROOT/"; then
    fail "Runtime snapshot copy failed."
    return 1
  fi

  # Preserve Spark deployment secrets and persisted data.
  cp -a "$backup_dir/.env" "${SUPABASE_ROOT}/.env" || return 1
  chmod 600 "${SUPABASE_ROOT}/.env"

  cat >"${SUPABASE_ROOT}/.supabase-version" <<EOF_SUPABASE_VERSION
# Supabase self-hosted version stamp. Managed by Spark Manager.
ref=${latest_ref}
EOF_SUPABASE_VERSION

  SUPABASE_REF="$latest_ref"
  SUPABASE_COMMIT="$current_commit"
  save_config

  # Re-apply Spark-owned environment, functions and compose hardening over the
  # fresh official runtime snapshot. No Spark SQL migrations are executed here.
  install_step_6 || return 1
  install_step_7 || return 1
  install_step_8 || return 1
  install_step_9 || return 1
  install_step_10 || return 1

  run_logged "Reload PostgREST schema cache" \
    compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -c "NOTIFY pgrst, 'reload schema';" || return 1

  run_logged "Validate upgraded Supabase runtime" supabase_core_ready || return 1

  ok "Supabase runtime updated successfully."
  printf 'Previous runtime: %s\n' "${current_ref:-unknown}"
  printf 'Current runtime : %s\n' "$latest_ref"
  printf 'Backup          : %s\n' "$backup_dir"
  printf 'Log             : %s\n' "$CURRENT_LOG"
}
