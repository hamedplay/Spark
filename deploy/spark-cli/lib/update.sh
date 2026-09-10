update_rollback_runtime() {
  local old_sha="$1" backup="$2"
  warn "Rollback runtime it started."
  if [[ -d "${backup}/frontend" ]]; then
    rsync -a --delete "${backup}/frontend/" /var/www/spark/ || true
    chown -R www-data:www-data /var/www/spark || true
  fi
  if [[ -d "${backup}/functions" ]]; then
    rsync -a --delete "${backup}/functions/" "${SUPABASE_ROOT}/volumes/functions/" || true
  fi
  if [[ -d "${SPARK_ROOT}/.git" ]]; then
    git -C "$SPARK_ROOT" reset --hard "$old_sha" || true
  fi
  if [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]]; then
    (cd "$SUPABASE_ROOT" && docker compose build avatar-worker && docker compose up -d --force-recreate functions avatar-worker) || true
  fi
  nginx -t && systemctl reload nginx || true
}

prepare_frontend_production_env() {
  local root="$1" anon
  anon="$(env_get "${SUPABASE_ROOT}/.env" ANON_KEY)"
  [[ -n "$anon" ]] || { fail "ANON_KEY not available; build Frontend it stopped."; return 1; }
  [[ -n "${API_DOMAIN:-}" ]] || { fail "API_DOMAIN not set; build Frontend it stopped."; return 1; }
  env_set "${root}/.env.production" VITE_SUPABASE_URL "https://${API_DOMAIN}"
  env_set "${root}/.env.production" VITE_SUPABASE_ANON_KEY "$anon"
  chmod 600 "${root}/.env.production"
}

validate_frontend_production_build() {
  local root="$1" expected="https://${API_DOMAIN}"
  [[ -f "${root}/dist/index.html" ]] || return 1
  grep -R -F -q -- "$expected" "${root}/dist" || {
    fail "Frontend build including SUPABASE URL Not expected: ${expected}"
    return 1
  }
}

create_update_runtime_backup() {
  local old_sha="$1" target_sha="$2" stamp dest
  stamp="$(date +%Y%m%d-%H%M%S)"
  dest="${BACKUP_DIR}/pre-update-runtime-${stamp}"
  mkdir -p "${dest}/frontend" "${dest}/functions" || return 1
  chmod 700 "$dest" || return 1

  [[ -d /var/www/spark ]] && cp -a /var/www/spark/. "${dest}/frontend/"
  [[ -d "${SUPABASE_ROOT}/volumes/functions" ]] && cp -a "${SUPABASE_ROOT}/volumes/functions/." "${dest}/functions/"
  printf '%s\n' "$old_sha" >"${dest}/git-old-sha"
  printf '%s\n' "$target_sha" >"${dest}/git-target-sha"
  chmod -R go-rwx "$dest"
  printf '%s\n' "$dest"
}

test_update_spark_validation() {
  require_manager_values || return 1
  echo "== Supabase local =="
  test_auth_health_url "http://127.0.0.1:8000/auth/v1/health" || return 1
  echo "== Frontend =="
  curl -fIsS "https://${APP_DOMAIN}" || return 1
  echo "== API =="
  test_auth_health_url "https://${API_DOMAIN}/auth/v1/health" || return 1
  echo "== Docker =="
  compose ps || return 1
  echo "== Scheduler =="
  test_schedulers || return 1
}

update_spark() (
  title
  new_log "update-spark"
  require_manager_values || return 1
  test_spark_repo >>"$CURRENT_LOG" 2>&1 || { fail "Spark repository not healthy."; return 1; }
  test_supabase_source >>"$CURRENT_LOG" 2>&1 || { fail "Supabase pin/runtime provenance not valid; First step 5 Check the installation."; return 1; }
  [[ -z "$(git -C "$SPARK_ROOT" status --porcelain)" ]] || {
    fail "Repository changes commit has not; Update it stopped."
    git -C "$SPARK_ROOT" status --short | tee -a "$CURRENT_LOG"
    return 1
  }

  local old_sha target_sha stage backup validation_image=""
  local functions_next="" functions_prev="" frontend_next="" frontend_prev=""
  local runtime_switched=0 update_success=0 source_advanced=0

  old_sha="$(git -C "$SPARK_ROOT" rev-parse HEAD)"
  run_logged "Fetch origin/main" git -C "$SPARK_ROOT" fetch origin main || return 1
  target_sha="$(git -C "$SPARK_ROOT" rev-parse origin/main)"
  info "Current: ${old_sha}"
  info "Target : ${target_sha}"

  if ! git -C "$SPARK_ROOT" merge-base --is-ancestor "$old_sha" "$target_sha"; then
    fail "origin/main Compared to the current version fast-forward is not; Update Automatic to avoid rewrite it stopped."
    return 1
  fi

  if [[ "$old_sha" == "$target_sha" ]]; then
    ok "Source Already on the last commit is."
  fi

  stage="/opt/spark-update-${target_sha:0:12}-$$"
  functions_next="${SUPABASE_ROOT}/volumes/functions.next.$$"
  functions_prev="${SUPABASE_ROOT}/volumes/functions.prev.$$"
  frontend_next="/var/www/spark.next.$$"
  frontend_prev="/var/www/spark.prev.$$"
  validation_image="spark-avatar-worker-validation:${target_sha:0:12}"

  rollback_after_switch() {
    warn "Rollback runtime it started."
    if [[ -d "$frontend_prev" ]]; then
      rm -rf /var/www/spark
      mv "$frontend_prev" /var/www/spark
      chown -R www-data:www-data /var/www/spark || true
    fi
    if [[ -d "$functions_prev" ]]; then
      rm -rf "${SUPABASE_ROOT}/volumes/functions"
      mv "$functions_prev" "${SUPABASE_ROOT}/volumes/functions"
    fi
    git -C "$SPARK_ROOT" reset --hard "$old_sha" >>"$CURRENT_LOG" 2>&1 || true
    (cd "$SUPABASE_ROOT" && docker compose build avatar-worker && docker compose up -d --force-recreate functions avatar-worker) >>"$CURRENT_LOG" 2>&1 || true
    nginx -t >>"$CURRENT_LOG" 2>&1 && systemctl reload nginx >>"$CURRENT_LOG" 2>&1 || true
    runtime_switched=0
  }

  cleanup_update_temp() {
    git -C "$SPARK_ROOT" worktree remove --force "$stage" >/dev/null 2>&1 || true
    rm -rf "$stage" "$functions_next" "$frontend_next"
    if (( update_success == 0 && source_advanced == 1 && runtime_switched == 0 )); then
      git -C "$SPARK_ROOT" reset --hard "$old_sha" >/dev/null 2>&1 || true
    fi
    if (( update_success == 1 || runtime_switched == 0 )); then
      rm -rf "$functions_prev" "$frontend_prev"
    fi
    docker image rm -f "$validation_image" >/dev/null 2>&1 || true
  }

  handle_update_signal() {
    if (( runtime_switched == 1 )); then
      rollback_after_switch
    fi
    exit 130
  }

  trap cleanup_update_temp EXIT
  trap handle_update_signal INT TERM

  rm -rf "$stage" "$functions_next" "$functions_prev" "$frontend_next" "$frontend_prev"
  run_logged "made worktree temporary for validation" git -C "$SPARK_ROOT" worktree add --detach "$stage" "$target_sha" || return 1

  run_logged "made env production Frontend in worktree" prepare_frontend_production_env "$stage" || return 1
  run_logged "npm ci in worktree temporary" bash -c "cd '$stage' && npm ci" || return 1
  run_logged "Production build before deploy" bash -c "cd '$stage' && npm run build" || return 1
  run_logged "Validate production Frontend environment" validate_frontend_production_build "$stage" || return 1

  if [[ -f "$stage/worker/Dockerfile" ]]; then
    run_logged "Validation build Avatar Worker from source new" docker build -t "$validation_image" -f "$stage/worker/Dockerfile" "$stage/worker" || return 1
  fi
  run_logged "Validate Docker Compose current" bash -c "cd '$SUPABASE_ROOT' && docker compose config --quiet" || return 1

  info "prepare Edge Functions New off the beaten path live..."
  mkdir -p "$functions_next"
  rsync -a --delete "${stage}/supabase/functions/" "${functions_next}/" >>"$CURRENT_LOG" 2>&1 || return 1
  rm -rf "${functions_next}/main"
  cp -a "${SUPABASE_SOURCE}/docker/volumes/functions/main" "${functions_next}/main" >>"$CURRENT_LOG" 2>&1 || return 1
  diff -qr --exclude=main "${stage}/supabase/functions" "$functions_next" >>"$CURRENT_LOG" 2>&1 || return 1
  diff -qr "${SUPABASE_SOURCE}/docker/volumes/functions/main" "${functions_next}/main" >>"$CURRENT_LOG" 2>&1 || return 1
  ok "Edge Functions staging validated"

  info "prepare Frontend New off the beaten path live..."
  mkdir -p "$frontend_next"
  rsync -a --delete "${stage}/dist/" "${frontend_next}/" >>"$CURRENT_LOG" 2>&1 || return 1
  [[ -f "${frontend_next}/index.html" ]] || { fail "Frontend staging lacking index.html is."; return 1; }
  chown -R www-data:www-data "$frontend_next"
  ok "Frontend staging validated"

  if ! backup="$(create_update_runtime_backup "$old_sha" "$target_sha")"; then
    fail "Backup runtime before Update failed; none deploy not done."
    return 1
  fi
  ok "Runtime backup: ${backup}"

  if [[ "$old_sha" != "$target_sha" ]]; then
    run_logged "Fast-forward /opt/spark to origin/main" git -C "$SPARK_ROOT" merge --ff-only "$target_sha" || return 1
    source_advanced=1
  fi

  if [[ -f "${SPARK_ROOT}/deploy/spark-cli/apply-daily-report-scheduler.sh" ]]; then
    run_visible "Reconcile exact daily-report scheduler" bash "${SPARK_ROOT}/deploy/spark-cli/apply-daily-report-scheduler.sh" || return 1
  fi

  if [[ -d "${SUPABASE_ROOT}/volumes/functions" ]]; then
    if ! mv "${SUPABASE_ROOT}/volumes/functions" "$functions_prev"; then
      fail "transmission runtime previous Functions failed."
      return 1
    fi
  fi
  if ! mv "$functions_next" "${SUPABASE_ROOT}/volumes/functions"; then
    [[ -d "$functions_prev" ]] && mv "$functions_prev" "${SUPABASE_ROOT}/volumes/functions" || true
    fail "Activation tree new Functions failed."
    return 1
  fi
  runtime_switched=1
  ok "Edge Functions runtime tree switched atomically"

  if [[ -d /var/www/spark ]]; then
    if ! mv /var/www/spark "$frontend_prev"; then
      rollback_after_switch
      fail "transmission Frontend The previous one failed."
      return 1
    fi
  fi
  if ! mv "$frontend_next" /var/www/spark; then
    [[ -d "$frontend_prev" ]] && mv "$frontend_prev" /var/www/spark || true
    rollback_after_switch
    fail "Activation Frontend New failed."
    return 1
  fi
  if ! chown -R www-data:www-data /var/www/spark; then
    rollback_after_switch
    fail "setting ownership Frontend failed."
    return 1
  fi
  ok "Frontend runtime tree switched atomically"

  if ! run_logged "Build Avatar Worker" bash -c "cd '$SUPABASE_ROOT' && docker compose build avatar-worker"; then
    rollback_after_switch
    return 1
  fi
  if ! run_logged "Recreate Functions + Avatar Worker" bash -c "cd '$SUPABASE_ROOT' && docker compose up -d --force-recreate functions avatar-worker"; then
    rollback_after_switch
    return 1
  fi
  if ! run_logged "Nginx config test" nginx -t; then
    rollback_after_switch
    return 1
  fi
  if ! run_logged "Reload Nginx" systemctl reload nginx; then
    rollback_after_switch
    return 1
  fi
  if ! run_logged "Post-update core health validation" test_update_spark_validation; then
    fail "Health validation failed."
    rollback_after_switch
    return 1
  fi

  update_success=1
  rm -rf "$functions_prev" "$frontend_prev"
  if [[ -f "${SPARK_ROOT}/deploy/spark-cli/spark" ]]; then
    run_logged "Update Spark Manager" install_manager_from_dir "${SPARK_ROOT}/deploy/spark-cli" || warn "application Update but Spark Manager Auto update failed; log Check out."
  fi

  ok "Update completed."
  printf 'Commit active: %s\n' "$(git -C "$SPARK_ROOT" rev-parse HEAD)"
  printf 'Runtime backup: %s\n' "$backup"
  printf 'Log: %s\n' "$CURRENT_LOG"
)
