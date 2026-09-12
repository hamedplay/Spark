# Late runtime fixes loaded after repair-override + env-modern.
#
# Keep the previous runtime fixes intact, then layer the offline-safe Supabase
# Edge Runtime main-router override on top. This prevents the official router's
# jsr:@panva/jose import from making all Edge Functions depend on public DNS /
# jsr.io during worker bootstrap when FUNCTIONS_VERIFY_JWT=false.

source "${SCRIPT_DIR}/lib/runtime-fixes-base.sh"

SPARK_EDGE_MAIN_ROUTER="${SPARK_ROOT}/deploy/spark-cli/edge-main/index.ts"

sync_spark_edge_main_router() {
  local source_main="${SUPABASE_SOURCE}/docker/volumes/functions/main"
  local target_main="${SUPABASE_ROOT}/volumes/functions/main"

  require_dir "$source_main" || return 1
  require_file "$SPARK_EDGE_MAIN_ROUTER" || return 1

  rm -rf "$target_main"
  mkdir -p "$target_main"
  cp -a "$source_main/." "$target_main/" || return 1
  install -m 0644 "$SPARK_EDGE_MAIN_ROUTER" "$target_main/index.ts" || return 1
}

test_function_sync() {
  diff -qr --exclude=main "${SPARK_ROOT}/supabase/functions" "${SUPABASE_ROOT}/volumes/functions" || return 1
  diff -qr --exclude=index.ts "${SUPABASE_SOURCE}/docker/volumes/functions/main" "${SUPABASE_ROOT}/volumes/functions/main" || return 1
  cmp -s "$SPARK_EDGE_MAIN_ROUTER" "${SUPABASE_ROOT}/volumes/functions/main/index.ts" || return 1
  ! grep -Eq "(^|[[:space:]])import[[:space:]].*jsr:@panva/jose" "${SUPABASE_ROOT}/volumes/functions/main/index.ts" || return 1
}

install_step_7() {
  title
  new_log "install-07-functions"
  require_dir "${SPARK_ROOT}/supabase/functions" || return 1
  require_dir "${SUPABASE_SOURCE}/docker/volumes/functions/main" || return 1
  require_file "$SPARK_EDGE_MAIN_ROUTER" || return 1

  mkdir -p "${SUPABASE_ROOT}/volumes/functions"
  run_logged "Sync all Edge Functions" \
    rsync -a --delete "${SPARK_ROOT}/supabase/functions/" "${SUPABASE_ROOT}/volumes/functions/" || return 1

  run_logged "Install offline-safe Spark Edge Runtime main router" \
    sync_spark_edge_main_router || return 1

  if run_logged "Compatibility test Edge Functions and offline-safe Main Router" test_function_sync; then
    mark_step 7
  else
    unmark_step 7
    return 1
  fi
}
