# Application-layer update helpers for Spark Manager.
#
# This module intentionally owns only the frontend/application source lifecycle.
# It must not apply SQL migrations, touch PostgreSQL, synchronize Edge Functions,
# rebuild Supabase/worker containers, reconcile schedulers, or update Manager.

application_prepare_frontend_env() {
  local root="$1" anon
  anon="$(env_get "${SUPABASE_ROOT}/.env" ANON_KEY)"
  [[ -n "$anon" ]] || { fail "ANON_KEY not available; frontend build stopped."; return 1; }
  [[ -n "${APP_DOMAIN:-}" ]] || { fail "APP_DOMAIN not set; frontend build stopped."; return 1; }

  env_set "${root}/.env.production" VITE_SUPABASE_URL "https://${APP_DOMAIN}"
  env_set "${root}/.env.production" VITE_SUPABASE_ANON_KEY "$anon"
  chmod 600 "${root}/.env.production"
}

application_validate_frontend_build() {
  local root="$1"
  [[ -f "${root}/dist/index.html" ]] || {
    fail "Frontend build is missing dist/index.html."
    return 1
  }

  if [[ -n "${API_DOMAIN:-}" ]] && grep -R -F -q -- "https://${API_DOMAIN}" "${root}/dist"; then
    fail "Frontend build still contains legacy API hostname: https://${API_DOMAIN}"
    return 1
  fi
  if grep -R -F -q -- '%VITE_SUPABASE_URL%' "${root}/dist"; then
    fail "Frontend build still contains unresolved VITE_SUPABASE_URL placeholder."
    return 1
  fi
}

application_frontend_health() {
  [[ -n "${APP_DOMAIN:-}" ]] || return 1
  curl --noproxy '*' -fIsS --connect-timeout 5 --max-time 10 \
    --resolve "${APP_DOMAIN}:443:127.0.0.1" \
    "https://${APP_DOMAIN}/" >/dev/null
}

update_spark() (
  title
  new_log "update-internet-app"

  [[ -d "${SPARK_ROOT}/.git" ]] || { fail "Spark source repository not found: ${SPARK_ROOT}"; return 1; }
  [[ -f "${SPARK_ROOT}/package.json" ]] || { fail "Application package.json not found in ${SPARK_ROOT}."; return 1; }
  [[ -f "${SUPABASE_ROOT}/.env" ]] || { fail "Supabase environment is required only to read the existing frontend ANON_KEY."; return 1; }

  if [[ -n "$(git -C "$SPARK_ROOT" status --porcelain)" ]]; then
    fail "Spark source has uncommitted changes; Internet App update stopped."
    git -C "$SPARK_ROOT" status --short | tee -a "$CURRENT_LOG"
    return 1
  fi

  local old_sha target_sha stage frontend_next frontend_prev
  local source_advanced=0 frontend_switched=0 update_success=0

  old_sha="$(git -C "$SPARK_ROOT" rev-parse HEAD)" || return 1
  run_logged "Fetch latest application source from origin/main" \
    git -C "$SPARK_ROOT" fetch origin main || return 1
  target_sha="$(git -C "$SPARK_ROOT" rev-parse origin/main)" || return 1

  info "Current application source: ${old_sha}"
  info "Target application source : ${target_sha}"

  if ! git -C "$SPARK_ROOT" merge-base --is-ancestor "$old_sha" "$target_sha"; then
    fail "origin/main is not a fast-forward from the current application source; update stopped."
    return 1
  fi

  stage="/opt/spark-app-update-${target_sha:0:12}-$$"
  frontend_next="/var/www/spark.next.$$"
  frontend_prev="/var/www/spark.prev.$$"

  rollback_application() {
    warn "Rolling back application layer only."
    if (( frontend_switched == 1 )); then
      rm -rf /var/www/spark
      if [[ -d "$frontend_prev" ]]; then
        mv "$frontend_prev" /var/www/spark
        chown -R www-data:www-data /var/www/spark || true
      fi
      frontend_switched=0
    fi
    if (( source_advanced == 1 )); then
      git -C "$SPARK_ROOT" reset --hard "$old_sha" >>"$CURRENT_LOG" 2>&1 || true
      source_advanced=0
    fi
  }

  cleanup_application_update() {
    git -C "$SPARK_ROOT" worktree remove --force "$stage" >/dev/null 2>&1 || true
    rm -rf "$stage" "$frontend_next"
    if (( update_success == 1 )); then
      rm -rf "$frontend_prev"
    elif (( frontend_switched == 0 )); then
      rm -rf "$frontend_prev"
    fi
  }

  handle_application_signal() {
    rollback_application
    exit 130
  }

  trap cleanup_application_update EXIT
  trap handle_application_signal INT TERM

  rm -rf "$stage" "$frontend_next" "$frontend_prev"

  run_logged "Create temporary application worktree" \
    git -C "$SPARK_ROOT" worktree add --detach "$stage" "$target_sha" || return 1

  run_logged "Prepare production frontend environment" \
    application_prepare_frontend_env "$stage" || return 1

  run_logged "Install application dependencies with npm ci" \
    bash -c "cd '$stage' && npm ci" || return 1

  run_logged "Build application with npm run build" \
    bash -c "cd '$stage' && npm run build" || return 1

  run_logged "Validate application build" \
    application_validate_frontend_build "$stage" || return 1

  mkdir -p "$frontend_next"
  rsync -a --delete "${stage}/dist/" "${frontend_next}/" >>"$CURRENT_LOG" 2>&1 || return 1
  [[ -f "${frontend_next}/index.html" ]] || { fail "Application staging is missing index.html."; return 1; }
  chown -R www-data:www-data "$frontend_next" || return 1

  if [[ "$old_sha" != "$target_sha" ]]; then
    run_logged "Fast-forward application source to origin/main" \
      git -C "$SPARK_ROOT" merge --ff-only "$target_sha" || return 1
    source_advanced=1
  fi

  if [[ -d /var/www/spark ]]; then
    mv /var/www/spark "$frontend_prev" || {
      rollback_application
      fail "Unable to stage previous frontend for application rollback."
      return 1
    }
  fi

  if ! mv "$frontend_next" /var/www/spark; then
    [[ -d "$frontend_prev" ]] && mv "$frontend_prev" /var/www/spark || true
    rollback_application
    fail "Unable to activate new application frontend."
    return 1
  fi
  frontend_switched=1
  chown -R www-data:www-data /var/www/spark || {
    rollback_application
    return 1
  }

  if ! run_logged "Validate deployed application frontend" application_frontend_health; then
    rollback_application
    return 1
  fi

  update_success=1
  rm -rf "$frontend_prev"
  frontend_switched=0

  ok "Internet App update completed. Database, migrations, Edge Functions, Supabase runtime, workers, schedulers and Manager were not changed."
  printf 'Application commit: %s\n' "$(git -C "$SPARK_ROOT" rev-parse HEAD)"
  printf 'Log: %s\n' "$CURRENT_LOG"
)
