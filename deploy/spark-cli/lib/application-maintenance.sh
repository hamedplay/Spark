#!/usr/bin/env bash
# Spark application maintenance actions.
#
# All functions in this module are application-layer only. They must not apply
# SQL migrations, mutate PostgreSQL, update Supabase runtime, synchronize Edge
# Functions, recreate workers/schedulers, or update the Spark Manager.

SPARK_APP_STATE_FILE="${STATE_DIR}/application-active.env"
SPARK_AIRGAP_HOME="${AIRGAP_HOME:-/opt/spark-airgap}"
SPARK_AIRGAP_CURRENT="${SPARK_AIRGAP_HOME}/current"

application_record_active_version() {
  local mode="$1" commit="$2"
  mkdir -p "$STATE_DIR"
  {
    printf 'mode=%s\n' "$mode"
    printf 'commit=%s\n' "$commit"
    printf 'deployed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'node=%s\n' "$(node --version 2>/dev/null || printf unavailable)"
    printf 'npm=%s\n' "$(npm --version 2>/dev/null || printf unavailable)"
  } >"$SPARK_APP_STATE_FILE"
  chmod 0600 "$SPARK_APP_STATE_FILE"
}

application_activate_dist() {
  local stage="$1"
  local frontend_next="/var/www/spark.next.$$"
  local frontend_prev="/var/www/spark.prev.$$"

  [[ -f "${stage}/dist/index.html" ]] || {
    fail "Application staging is missing dist/index.html."
    return 1
  }

  rm -rf "$frontend_next" "$frontend_prev"
  mkdir -p "$frontend_next"
  rsync -a --delete "${stage}/dist/" "$frontend_next/" >>"$CURRENT_LOG" 2>&1 || {
    rm -rf "$frontend_next"
    return 1
  }
  chown -R www-data:www-data "$frontend_next" || {
    rm -rf "$frontend_next"
    return 1
  }

  if [[ -d /var/www/spark ]]; then
    mv /var/www/spark "$frontend_prev" || {
      rm -rf "$frontend_next"
      fail "Unable to stage previous frontend for rollback."
      return 1
    }
  fi

  if ! mv "$frontend_next" /var/www/spark; then
    [[ -d "$frontend_prev" ]] && mv "$frontend_prev" /var/www/spark || true
    rm -rf "$frontend_next"
    fail "Unable to activate application frontend."
    return 1
  fi
  chown -R www-data:www-data /var/www/spark || true

  if ! application_frontend_health; then
    warn "Frontend health validation failed; restoring previous application."
    rm -rf /var/www/spark
    [[ -d "$frontend_prev" ]] && mv "$frontend_prev" /var/www/spark
    [[ -d /var/www/spark ]] && chown -R www-data:www-data /var/www/spark || true
    return 1
  fi

  rm -rf "$frontend_prev"
}

application_active_airgap_root() {
  if [[ -L "$SPARK_AIRGAP_CURRENT" || -d "$SPARK_AIRGAP_CURRENT" ]]; then
    readlink -f "$SPARK_AIRGAP_CURRENT"
    return 0
  fi
  fail "No active Air-Gap bundle. Import/activate an Air-Gap bundle first."
  return 1
}

application_airgap_meta() {
  local root="$1" key="$2" manifest="${1}/metadata/manifest.env"
  [[ -f "$manifest" ]] || return 1
  sed -n "s/^${key}=//p" "$manifest" | tail -n1
}

application_update_offline() (
  title
  new_log "update-offline-app"

  [[ -d "${SPARK_ROOT}/.git" ]] || { fail "Spark source repository not found: ${SPARK_ROOT}"; return 1; }
  [[ -f "${SUPABASE_ROOT}/.env" ]] || { fail "Supabase environment is required only to read the existing frontend ANON_KEY."; return 1; }
  if [[ -n "$(git -C "$SPARK_ROOT" status --porcelain)" ]]; then
    fail "Spark source has uncommitted changes; Offline App update stopped."
    git -C "$SPARK_ROOT" status --short | tee -a "$CURRENT_LOG"
    return 1
  fi

  local root bundle node_archive target_sha old_sha fetched_sha stage
  local source_advanced=0 update_success=0
  root="$(application_active_airgap_root)" || return 1
  bundle="${root}/sources/spark.git.bundle"
  node_archive="${root}/npm/frontend-node-modules.tar.gz"
  [[ -f "$bundle" ]] || { fail "Air-Gap Spark source bundle is missing: $bundle"; return 1; }
  [[ -f "$node_archive" ]] || { fail "Air-Gap frontend dependency archive is missing: $node_archive"; return 1; }

  target_sha="$(application_airgap_meta "$root" SPARK_COMMIT)"
  [[ "$target_sha" =~ ^[0-9a-f]{40}$ ]] || { fail "Air-Gap SPARK_COMMIT is invalid."; return 1; }
  old_sha="$(git -C "$SPARK_ROOT" rev-parse HEAD)" || return 1

  run_logged "Fetch offline application revision from active bundle" \
    git -C "$SPARK_ROOT" fetch "$bundle" main || return 1
  fetched_sha="$(git -C "$SPARK_ROOT" rev-parse FETCH_HEAD)" || return 1
  [[ "$fetched_sha" == "$target_sha" ]] || {
    fail "Air-Gap manifest/source revision mismatch."
    return 1
  }
  if ! git -C "$SPARK_ROOT" merge-base --is-ancestor "$old_sha" "$target_sha"; then
    fail "Offline application bundle is not a fast-forward from current source."
    return 1
  fi

  stage="/opt/spark-app-offline-${target_sha:0:12}-$$"
  rm -rf "$stage"
  cleanup_offline_app() {
    git -C "$SPARK_ROOT" worktree remove --force "$stage" >/dev/null 2>&1 || true
    rm -rf "$stage"
  }
  rollback_offline_source() {
    if (( source_advanced == 1 )); then
      git -C "$SPARK_ROOT" reset --hard "$old_sha" >>"$CURRENT_LOG" 2>&1 || true
    fi
  }
  trap cleanup_offline_app EXIT
  trap 'rollback_offline_source; exit 130' INT TERM

  run_logged "Create offline application staging worktree" \
    git -C "$SPARK_ROOT" worktree add --detach "$stage" "$target_sha" || return 1
  run_logged "Restore bundled frontend dependencies" \
    tar -xzf "$node_archive" -C "$stage" || return 1
  run_logged "Prepare production frontend environment" \
    application_prepare_frontend_env "$stage" || return 1
  run_logged "Build offline application with npm" \
    bash -c "cd '$stage' && npm_config_offline=true npm_config_audit=false npm_config_fund=false npm run build" || return 1
  run_logged "Validate offline application build" \
    application_validate_frontend_build "$stage" || return 1

  if [[ "$old_sha" != "$target_sha" ]]; then
    run_logged "Fast-forward local application source to offline revision" \
      git -C "$SPARK_ROOT" merge --ff-only "$target_sha" || return 1
    source_advanced=1
  fi

  if ! application_activate_dist "$stage"; then
    rollback_offline_source
    return 1
  fi

  application_record_active_version "offline" "$target_sha"
  update_success=1
  ok "Offline App update completed. Database, migrations, Supabase runtime, Edge Functions, workers, schedulers and Manager were not changed."
  printf 'Application commit: %s\n' "$target_sha"
  printf 'Air-Gap bundle    : %s\n' "$(basename "$root")"
  printf 'Log               : %s\n' "$CURRENT_LOG"
)

application_npm_update() (
  title
  new_log "npm-update-app"

  [[ -d "${SPARK_ROOT}/.git" ]] || { fail "Spark source repository not found."; return 1; }
  [[ -f "${SPARK_ROOT}/package.json" && -f "${SPARK_ROOT}/package-lock.json" ]] || {
    fail "Application package metadata is incomplete."
    return 1
  }
  [[ -f "${SUPABASE_ROOT}/.env" ]] || { fail "Supabase environment is required only to read the existing frontend ANON_KEY."; return 1; }
  if [[ -n "$(git -C "$SPARK_ROOT" status --porcelain)" ]]; then
    fail "Spark source has uncommitted changes; npm update app stopped."
    git -C "$SPARK_ROOT" status --short | tee -a "$CURRENT_LOG"
    return 1
  fi

  local sha stage
  sha="$(git -C "$SPARK_ROOT" rev-parse HEAD)" || return 1
  stage="/opt/spark-app-npm-update-${sha:0:12}-$$"
  rm -rf "$stage"
  trap 'git -C "$SPARK_ROOT" worktree remove --force "$stage" >/dev/null 2>&1 || true; rm -rf "$stage"' EXIT

  run_logged "Create npm update staging worktree" \
    git -C "$SPARK_ROOT" worktree add --detach "$stage" "$sha" || return 1
  run_logged "Install locked application dependencies" \
    bash -c "cd '$stage' && npm ci" || return 1
  run_logged "Update application dependencies within package constraints" \
    bash -c "cd '$stage' && npm update --no-audit --no-fund" || return 1
  run_report "Updated application dependency versions" \
    bash -c "cd '$stage' && npm list --depth=0" || true
  run_logged "Prepare production frontend environment" \
    application_prepare_frontend_env "$stage" || return 1
  run_logged "Build application after npm update" \
    bash -c "cd '$stage' && npm run build" || return 1
  run_logged "Validate npm-updated application build" \
    application_validate_frontend_build "$stage" || return 1
  application_activate_dist "$stage" || return 1

  application_record_active_version "npm-update" "$sha"
  ok "npm update app completed in staging and deployed. Source package.json/package-lock.json were not modified."
  printf 'Application commit: %s\n' "$sha"
  printf 'Log: %s\n' "$CURRENT_LOG"
)

application_node_update() {
  title
  new_log "node-update-app"
  command -v node >/dev/null 2>&1 || { fail "Node.js is not installed."; return 1; }
  [[ -f "${SPARK_ROOT}/package.json" ]] || { fail "Application package.json not found."; return 1; }

  local before after
  before="$(node --version)"
  info "Current Node.js: $before"
  run_logged "Refresh Linux package metadata for Node.js" apt-get update || return 1
  run_logged "Update Node.js package" apt-get install -y --only-upgrade nodejs || return 1

  if ! node -e 'const [M,m,p]=process.versions.node.split(".").map(Number); if (!(M===24 && (m>18 || (m===18 && p>=1)))) process.exit(1)'; then
    fail "Updated Node.js does not satisfy Spark engine >=24.18.1 <25."
    node --version | tee -a "$CURRENT_LOG"
    return 1
  fi
  after="$(node --version)"
  ok "Node.js application runtime updated and validated."
  printf 'Before: %s\nAfter : %s\n' "$before" "$after"
}

application_npm_outdated() {
  title
  new_log "npm-outdated-app"
  [[ -f "${SPARK_ROOT}/package.json" ]] || { fail "Application package.json not found."; return 1; }
  run_report "Application npm outdated" bash -c "cd '$SPARK_ROOT' && npm outdated"
}

application_npm_audit_production() {
  title
  new_log "npm-audit-production"
  [[ -f "${SPARK_ROOT}/package-lock.json" ]] || { fail "Application package-lock.json not found."; return 1; }
  run_report "Application npm audit production" \
    bash -c "cd '$SPARK_ROOT' && npm audit --omit=dev"
}

application_npm_audit_all() {
  title
  new_log "npm-audit-all"
  [[ -f "${SPARK_ROOT}/package-lock.json" ]] || { fail "Application package-lock.json not found."; return 1; }
  run_report "Application npm audit all" \
    bash -c "cd '$SPARK_ROOT' && npm audit"
}

application_npm_list() {
  title
  new_log "npm-list-app"
  [[ -f "${SPARK_ROOT}/package.json" ]] || { fail "Application package.json not found."; return 1; }
  run_report "Application npm list" \
    bash -c "cd '$SPARK_ROOT' && npm list --depth=0"
}

application_npm_doctor() {
  title
  new_log "npm-doctor-app"
  [[ -f "${SPARK_ROOT}/package.json" ]] || { fail "Application package.json not found."; return 1; }
  run_report "Application npm doctor" \
    bash -c "cd '$SPARK_ROOT' && npm doctor"
}

application_active_version() {
  title
  new_log "application-active-version"
  {
    echo "== Active Spark Application =="
    if [[ -d "${SPARK_ROOT}/.git" ]]; then
      echo "Source commit : $(git -C "$SPARK_ROOT" rev-parse HEAD)"
      echo "Source branch : $(git -C "$SPARK_ROOT" branch --show-current)"
      echo "Source dirty  : $(test -z "$(git -C "$SPARK_ROOT" status --porcelain)" && echo no || echo yes)"
    else
      echo "Source commit : unavailable"
    fi
    if [[ -f "$SPARK_APP_STATE_FILE" ]]; then
      echo
      echo "== Last Application Deployment =="
      cat "$SPARK_APP_STATE_FILE"
    fi
    echo
    echo "== Application Package =="
    if [[ -f "${SPARK_ROOT}/package.json" ]]; then
      node -e "const p=require('${SPARK_ROOT}/package.json'); console.log('name='+p.name); console.log('version='+p.version); console.log('node_engine='+(p.engines?.node||'n/a'))"
    fi
    echo "node=$(node --version 2>/dev/null || echo unavailable)"
    echo "npm=$(npm --version 2>/dev/null || echo unavailable)"
    if [[ -f /var/www/spark/index.html ]]; then
      echo "frontend_index_mtime=$(stat -c '%y' /var/www/spark/index.html)"
    fi
  } 2>&1 | tee -a "$CURRENT_LOG"
}
