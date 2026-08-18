update_rollback_runtime() {
  local old_sha="$1" backup="$2"
  warn "Rollback runtime شروع شد؛ migration دیتابیس خودکار rollback نمی‌شود."
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

update_spark() (
  title
  new_log "update-spark"
  require_manager_values || return 1
  test_spark_repo >>"$CURRENT_LOG" 2>&1 || { fail "Spark repository سالم نیست."; return 1; }
  test_supabase_source >>"$CURRENT_LOG" 2>&1 || { fail "Supabase pin/runtime provenance معتبر نیست؛ ابتدا مرحله 5 نصب را بررسی کنید."; return 1; }
  [[ -z "$(git -C "$SPARK_ROOT" status --porcelain)" ]] || {
    fail "Repository تغییرات commit نشده دارد؛ Update متوقف شد."
    git -C "$SPARK_ROOT" status --short | tee -a "$CURRENT_LOG"
    return 1
  }

  local old_sha target_sha stage backup migrations_changed=0 validation_image=""
  local functions_next="" functions_prev="" frontend_next="" frontend_prev=""
  local runtime_switched=0 update_success=0 source_advanced=0

  old_sha="$(git -C "$SPARK_ROOT" rev-parse HEAD)"
  run_logged "Fetch origin/main" git -C "$SPARK_ROOT" fetch origin main || return 1
  target_sha="$(git -C "$SPARK_ROOT" rev-parse origin/main)"
  info "Current: ${old_sha}"
  info "Target : ${target_sha}"

  if ! git -C "$SPARK_ROOT" merge-base --is-ancestor "$old_sha" "$target_sha"; then
    fail "origin/main نسبت به نسخه فعلی fast-forward نیست؛ Update خودکار برای جلوگیری از rewrite متوقف شد."
    return 1
  fi

  if [[ "$old_sha" != "$target_sha" ]]; then
    local bad_migrations
    bad_migrations="$(git -C "$SPARK_ROOT" diff --name-status "$old_sha" "$target_sha" -- supabase/migrations/ | awk '$1 !~ /^A/ {print}' || true)"
    if [[ -n "$bad_migrations" ]]; then
      fail "Migration موجود بین Current و Target ویرایش/حذف/rename شده است؛ طبق policy اسپارک Update متوقف شد."
      printf '%s\n' "$bad_migrations" | tee -a "$CURRENT_LOG"
      return 1
    fi
    if git -C "$SPARK_ROOT" diff --name-status "$old_sha" "$target_sha" -- supabase/migrations/ | awk '$1 ~ /^A/ {found=1} END{exit !found}'; then
      migrations_changed=1
      info "Migration جدید بین Current و Target تشخیص داده شد."
    else
      ok "Migration جدیدی بین Current و Target وجود ندارد."
    fi
  else
    ok "Source از قبل روی آخرین commit است."
  fi

  stage="/opt/spark-update-${target_sha:0:12}-$$"
  functions_next="${SUPABASE_ROOT}/volumes/functions.next.$$"
  functions_prev="${SUPABASE_ROOT}/volumes/functions.prev.$$"
  frontend_next="/var/www/spark.next.$$"
  frontend_prev="/var/www/spark.prev.$$"
  validation_image="spark-avatar-worker-validation:${target_sha:0:12}"

  rollback_after_switch() {
    warn "Rollback runtime شروع شد؛ migration دیتابیس خودکار rollback نمی‌شود."
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
  run_logged "ساخت worktree موقت برای validation" git -C "$SPARK_ROOT" worktree add --detach "$stage" "$target_sha" || return 1

  run_logged "npm ci در worktree موقت" bash -c "cd '$stage' && npm ci" || return 1
  run_logged "Production build قبل از deploy" bash -c "cd '$stage' && npm run build" || return 1

  if [[ -f "$stage/worker/Dockerfile" ]]; then
    run_logged "Validation build Avatar Worker از source جدید" docker build -t "$validation_image" -f "$stage/worker/Dockerfile" "$stage/worker" || return 1
  fi
  run_logged "Validate Docker Compose فعلی" bash -c "cd '$SUPABASE_ROOT' && docker compose config --quiet" || return 1

  info "آماده‌سازی Edge Functions جدید خارج از مسیر live..."
  mkdir -p "$functions_next"
  rsync -a --delete "${stage}/supabase/functions/" "${functions_next}/" >>"$CURRENT_LOG" 2>&1 || return 1
  rm -rf "${functions_next}/main"
  cp -a "${SUPABASE_SOURCE}/docker/volumes/functions/main" "${functions_next}/main" >>"$CURRENT_LOG" 2>&1 || return 1
  diff -qr --exclude=main "${stage}/supabase/functions" "$functions_next" >>"$CURRENT_LOG" 2>&1 || return 1
  diff -qr "${SUPABASE_SOURCE}/docker/volumes/functions/main" "${functions_next}/main" >>"$CURRENT_LOG" 2>&1 || return 1
  ok "Edge Functions staging validated"

  info "آماده‌سازی Frontend جدید خارج از مسیر live..."
  mkdir -p "$frontend_next"
  rsync -a --delete "${stage}/dist/" "${frontend_next}/" >>"$CURRENT_LOG" 2>&1 || return 1
  [[ -f "${frontend_next}/index.html" ]] || { fail "Frontend staging فاقد index.html است."; return 1; }
  chown -R www-data:www-data "$frontend_next"
  ok "Frontend staging validated"

  if ! backup="$(create_backup pre-update)"; then
    fail "Backup قبل از Update شکست خورد؛ هیچ deploy انجام نشد."
    return 1
  fi
  ok "Backup: ${backup}"
  mkdir -p "${backup}/frontend" "${backup}/functions"
  [[ -d /var/www/spark ]] && cp -a /var/www/spark/. "${backup}/frontend/"
  [[ -d "${SUPABASE_ROOT}/volumes/functions" ]] && cp -a "${SUPABASE_ROOT}/volumes/functions/." "${backup}/functions/"
  printf '%s\n' "$old_sha" >"${backup}/git-old-sha"
  printf '%s\n' "$target_sha" >"${backup}/git-target-sha"

  if (( migrations_changed )); then
    run_visible "Migration dry-run روی source جدید" migration_dry_run "$stage" || return 1
    if ! confirm_word "Backup ایجاد شده است. برای اعمال migrationهای جدید تأیید لازم است." "MIGRATE"; then
      warn "Update قبل از تغییر Production لغو شد."
      return 1
    fi
    run_logged "اعمال migrationهای جدید" migration_apply "$stage" || return 1
    run_logged "Migration post-check" migration_dry_run "$stage" || return 1
  fi

  if [[ "$old_sha" != "$target_sha" ]]; then
    run_logged "Fast-forward /opt/spark به origin/main" git -C "$SPARK_ROOT" merge --ff-only "$target_sha" || return 1
    source_advanced=1
  fi

  # Atomic directory swaps: the old runtime tree remains available until the new
  # containers / Nginx are validated.
  if [[ -d "${SUPABASE_ROOT}/volumes/functions" ]]; then
    if ! mv "${SUPABASE_ROOT}/volumes/functions" "$functions_prev"; then
      fail "انتقال runtime قبلی Functions شکست خورد."
      return 1
    fi
  fi
  if ! mv "$functions_next" "${SUPABASE_ROOT}/volumes/functions"; then
    [[ -d "$functions_prev" ]] && mv "$functions_prev" "${SUPABASE_ROOT}/volumes/functions" || true
    fail "فعال‌سازی tree جدید Functions شکست خورد."
    return 1
  fi
  runtime_switched=1
  ok "Edge Functions runtime tree switched atomically"

  if [[ -d /var/www/spark ]]; then
    if ! mv /var/www/spark "$frontend_prev"; then
      rollback_after_switch
      fail "انتقال Frontend قبلی شکست خورد."
      return 1
    fi
  fi
  if ! mv "$frontend_next" /var/www/spark; then
    [[ -d "$frontend_prev" ]] && mv "$frontend_prev" /var/www/spark || true
    rollback_after_switch
    fail "فعال‌سازی Frontend جدید شکست خورد."
    return 1
  fi
  if ! chown -R www-data:www-data /var/www/spark; then
    rollback_after_switch
    fail "تنظیم ownership Frontend شکست خورد."
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
  if ! run_logged "Post-update health validation" test_full_validation; then
    fail "Health validation شکست خورد."
    rollback_after_switch
    return 1
  fi

  update_success=1
  rm -rf "$functions_prev" "$frontend_prev"
  if [[ -f "${SPARK_ROOT}/deploy/spark-cli/spark" ]]; then
    run_logged "به‌روزرسانی Spark Manager" install_manager_from_dir "${SPARK_ROOT}/deploy/spark-cli" || warn "برنامه Update شد ولی Spark Manager خودکار به‌روزرسانی نشد؛ log را بررسی کنید."
  fi

  ok "Update کامل شد."
  printf 'Commit فعال: %s\n' "$(git -C "$SPARK_ROOT" rev-parse HEAD)"
  printf 'Backup: %s\n' "$backup"
  printf 'Log: %s\n' "$CURRENT_LOG"
)
