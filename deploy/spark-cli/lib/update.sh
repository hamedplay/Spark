update_rollback_runtime() {
  local old_sha="$1" backup="$2"
  warn "Rollback runtime شروع شد."
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
  [[ -n "$anon" ]] || { fail "ANON_KEY موجود نیست؛ build Frontend متوقف شد."; return 1; }
  [[ -n "${API_DOMAIN:-}" ]] || { fail "API_DOMAIN تنظیم نشده؛ build Frontend متوقف شد."; return 1; }
  env_set "${root}/.env.production" VITE_SUPABASE_URL "https://${API_DOMAIN}"
  env_set "${root}/.env.production" VITE_SUPABASE_ANON_KEY "$anon"
  chmod 600 "${root}/.env.production"
}

validate_frontend_production_build() {
  local root="$1" expected="https://${API_DOMAIN}"
  [[ -f "${root}/dist/index.html" ]] || return 1
  grep -R -F -q -- "$expected" "${root}/dist" || {
    fail "Frontend build شامل SUPABASE URL مورد انتظار نیست: ${expected}"
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

list_pending_spark_migrations() {
  local migration_dir="${1:-${SPARK_ROOT}/supabase/migrations}"
  local applied version file

  [[ -d "$migration_dir" ]] || return 0

  applied="$(compose exec -T db psql -U postgres -d postgres -Atqc \
    'select version from supabase_migrations.schema_migrations order by version;' 2>/dev/null \
    | tr -d '\r' | sort -u)" || return 1

  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    version="$(basename "$file" | sed -nE 's/^([0-9]{14})_.*/\1/p')"
    [[ -n "$version" ]] || continue
    if ! grep -Fxq "$version" <<<"$applied"; then
      printf '%s\n' "$file"
    fi
  done < <(find "$migration_dir" -maxdepth 1 -type f -name '*.sql' | sort)
}

apply_one_spark_migration() {
  local file="$1" base version name
  base="$(basename "$file")"
  version="$(sed -nE 's/^([0-9]{14})_.*/\1/p' <<<"$base")"
  name="$(sed -nE 's/^[0-9]{14}_(.*)\.sql$/\1/p' <<<"$base")"

  [[ "$version" =~ ^[0-9]{14}$ ]] || { fail "Migration version نامعتبر است: $base"; return 1; }
  [[ "$name" =~ ^[A-Za-z0-9_]+$ ]] || { fail "Migration name نامعتبر است: $base"; return 1; }

  {
    printf '\\set ON_ERROR_STOP on\nBEGIN;\n'
    cat "$file"
    printf '\nINSERT INTO supabase_migrations.schema_migrations(version, name) VALUES (\x27%s\x27, \x27%s\x27);\n' "$version" "$name"
    printf "NOTIFY pgrst, 'reload schema';\nCOMMIT;\n"
  } | compose exec -T db psql -U postgres -d postgres
}

reconcile_spark_migrations() {
  local migration_dir="${1:-${SPARK_ROOT}/supabase/migrations}"
  local pending=() file answer

  mapfile -t pending < <(list_pending_spark_migrations "$migration_dir") || return 1
  if (("${#pending[@]}" == 0)); then
    ok "Database migrations از قبل همگام هستند."
    return 0
  fi

  warn "${#pending[@]} migration اعمال‌نشده در Database سلف‌هاست پیدا شد:"
  for file in "${pending[@]}"; do
    printf '  - %s\n' "$(basename "$file")"
  done

  printf '\n'
  read -r -p "برای اعمال migrationهای بالا عبارت MIGRATE را وارد کنید: " answer
  [[ "$answer" == "MIGRATE" ]] || {
    fail "Migration تأیید نشد؛ Update قبل از deploy Frontend متوقف شد."
    return 1
  }

  for file in "${pending[@]}"; do
    run_logged "Apply migration $(basename "$file")" apply_one_spark_migration "$file" || return 1
  done

  if ! installation_migrations_current; then
    fail "پس از migration هنوز Database با repository همگام نیست."
    return 1
  fi

  run_logged "Reload PostgREST schema cache" bash -c "cd '$SUPABASE_ROOT' && docker compose exec -T db psql -U postgres -d postgres -c \"NOTIFY pgrst, 'reload schema';\"" || return 1
  ok "Database migrations و PostgREST schema cache همگام شدند."
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

  local old_sha target_sha stage backup validation_image=""
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

  if [[ "$old_sha" == "$target_sha" ]]; then
    ok "Source از قبل روی آخرین commit است."
  fi

  stage="/opt/spark-update-${target_sha:0:12}-$$"
  functions_next="${SUPABASE_ROOT}/volumes/functions.next.$$"
  functions_prev="${SUPABASE_ROOT}/volumes/functions.prev.$$"
  frontend_next="/var/www/spark.next.$$"
  frontend_prev="/var/www/spark.prev.$$"
  validation_image="spark-avatar-worker-validation:${target_sha:0:12}"

  rollback_after_switch() {
    warn "Rollback runtime شروع شد."
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

  run_logged "ساخت env تولید Frontend در worktree" prepare_frontend_production_env "$stage" || return 1
  run_logged "npm ci در worktree موقت" bash -c "cd '$stage' && npm ci" || return 1
  run_logged "Production build قبل از deploy" bash -c "cd '$stage' && npm run build" || return 1
  run_logged "Validate production Frontend environment" validate_frontend_production_build "$stage" || return 1

  if [[ -f "$stage/worker/Dockerfile" ]]; then
    run_logged "Validation build Avatar Worker از source جدید" docker build -t "$validation_image" -f "$stage/worker/Dockerfile" "$stage/worker" || return 1
  fi
  run_logged "Validate Docker Compose فعلی" bash -c "cd '$SUPABASE_ROOT' && docker compose config --quiet" || return 1

  run_logged "بررسی اتصال Database برای migration" bash -c "cd '$SUPABASE_ROOT' && docker compose exec -T db psql -U postgres -d postgres -Atqc 'select 1' | grep -qx 1" || return 1
  reconcile_spark_migrations "$stage/supabase/migrations" || return 1

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

  if ! backup="$(create_update_runtime_backup "$old_sha" "$target_sha")"; then
    fail "Backup runtime قبل از Update شکست خورد؛ هیچ deploy انجام نشد."
    return 1
  fi
  ok "Runtime backup: ${backup}"

  if [[ "$old_sha" != "$target_sha" ]]; then
    run_logged "Fast-forward /opt/spark به origin/main" git -C "$SPARK_ROOT" merge --ff-only "$target_sha" || return 1
    source_advanced=1
  fi

  if [[ -f "${SPARK_ROOT}/deploy/spark-cli/apply-daily-report-scheduler.sh" ]]; then
    run_visible "Reconcile exact daily-report scheduler" bash "${SPARK_ROOT}/deploy/spark-cli/apply-daily-report-scheduler.sh" || return 1
  fi

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
  if ! run_logged "Post-update core health validation" test_update_spark_validation; then
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
  printf 'Runtime backup: %s\n' "$backup"
  printf 'Log: %s\n' "$CURRENT_LOG"
)
