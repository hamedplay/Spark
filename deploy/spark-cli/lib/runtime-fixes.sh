# Late runtime fixes loaded after repair-override + env-modern.
#
# Keep the previous runtime fixes intact, then layer the offline-safe Supabase
# Edge Runtime main-router override on top. This prevents the official router's
# jsr:@panva/jose import from making all Edge Functions depend on public DNS /
# jsr.io during worker bootstrap when FUNCTIONS_VERIFY_JWT=false.
#
# Supabase source provenance is also overridden here because modern self-hosted
# deployments are pinned to a stable self-hosted/vX.Y.Z release instead of the
# moving upstream main branch. Runtime .supabase-version, the exact source tag,
# and the optional manager.conf pin must all agree.

source "${SCRIPT_DIR}/lib/runtime-fixes-base.sh"

SPARK_EDGE_MAIN_ROUTER="${SPARK_ROOT}/deploy/spark-cli/edge-main/index.ts"

spark_supabase_runtime_ref() {
  local stamp="${SUPABASE_ROOT}/.supabase-version"
  [[ -f "$stamp" ]] || return 1
  sed -n 's/^ref=//p' "$stamp" | tail -n1
}

spark_supabase_stable_ref_from_source() {
  git -C "$SUPABASE_SOURCE" tag -l 'self-hosted/v*' 2>/dev/null \
    | grep -E '^self-hosted/v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V \
    | tail -n1
}

test_supabase_source() {
  require_dir "${SUPABASE_SOURCE}/.git" || return 1
  require_file "${SUPABASE_SOURCE}/docker/docker-compose.yml" || return 1
  require_file "${SUPABASE_ROOT}/docker-compose.yml" || return 1
  require_file "${SUPABASE_ROOT}/.env" || return 1
  require_file "${SUPABASE_ROOT}/.supabase-version" || return 1

  [[ "$(git -C "$SUPABASE_SOURCE" remote get-url origin)" == "https://github.com/supabase/supabase.git" ]] || return 1
  [[ -z "$(git -C "$SUPABASE_SOURCE" status --porcelain)" ]] || return 1

  local actual source_ref tagged_commit runtime_ref
  actual="$(git -C "$SUPABASE_SOURCE" rev-parse HEAD)" || return 1
  source_ref="$(git -C "$SUPABASE_SOURCE" describe --tags --exact-match "$actual" 2>/dev/null)" || return 1
  [[ "$source_ref" =~ ^self-hosted/v[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1

  tagged_commit="$(git -C "$SUPABASE_SOURCE" rev-list -n1 "$source_ref" 2>/dev/null)" || return 1
  [[ "$tagged_commit" == "$actual" ]] || return 1

  runtime_ref="$(spark_supabase_runtime_ref)" || return 1
  [[ "$runtime_ref" == "$source_ref" ]] || return 1

  [[ -z "${SUPABASE_REF:-}" || "$SUPABASE_REF" == "$source_ref" ]] || return 1
  [[ -z "${SUPABASE_COMMIT:-}" || "$SUPABASE_COMMIT" == "$actual" ]] || return 1
}

install_step_4() {
  title
  new_log "install-04-supabase-stable-pin"

  mkdir -p /opt
  if [[ -d "${SUPABASE_SOURCE}/.git" ]]; then
    if [[ -n "$(git -C "$SUPABASE_SOURCE" status --porcelain)" ]]; then
      fail "${SUPABASE_SOURCE} has uncommitted changes; refusing to replace the pinned Supabase source."
      git -C "$SUPABASE_SOURCE" status --short | tee -a "$CURRENT_LOG"
      return 1
    fi
    run_logged "Fetch official Supabase stable tags" \
      git -C "$SUPABASE_SOURCE" fetch origin --tags --prune || return 1
  elif [[ -e "$SUPABASE_SOURCE" ]]; then
    fail "${SUPABASE_SOURCE} exists but is not a Git repository."
    return 1
  else
    run_logged "Clone official Supabase source" \
      git clone https://github.com/supabase/supabase.git "$SUPABASE_SOURCE" || return 1
    run_logged "Fetch official Supabase stable tags" \
      git -C "$SUPABASE_SOURCE" fetch origin --tags --prune || return 1
  fi

  local latest_ref latest_commit runtime_ref
  latest_ref="$(spark_supabase_stable_ref_from_source)"
  [[ "$latest_ref" =~ ^self-hosted/v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    fail "Unable to resolve the latest stable Supabase self-hosted release."
    return 1
  }

  run_logged "Checkout pinned Supabase ${latest_ref}" \
    git -C "$SUPABASE_SOURCE" checkout --detach "$latest_ref" || return 1
  latest_commit="$(git -C "$SUPABASE_SOURCE" rev-parse HEAD)" || return 1

  if [[ -f "${SUPABASE_ROOT}/.env" ]]; then
    runtime_ref="$(spark_supabase_runtime_ref 2>/dev/null || true)"
    if [[ -z "$runtime_ref" ]]; then
      fail "Active Supabase runtime has no .supabase-version stamp; refusing to assume provenance."
      return 1
    fi
    if [[ "$runtime_ref" != "$latest_ref" ]]; then
      fail "Active Supabase runtime is ${runtime_ref}, while source resolved to ${latest_ref}; update the runtime before advancing the source pin."
      return 1
    fi
    info "Active Supabase runtime already matches ${latest_ref}; preserving customized runtime/config."
  else
    rm -rf "$SUPABASE_ROOT"
    mkdir -p "$SUPABASE_ROOT"
    run_logged "Copy pinned Supabase Docker snapshot" \
      cp -a "${SUPABASE_SOURCE}/docker/." "$SUPABASE_ROOT/" || return 1
    run_logged "Create primary Supabase .env" \
      cp "${SUPABASE_ROOT}/.env.example" "${SUPABASE_ROOT}/.env" || return 1
    chmod 600 "${SUPABASE_ROOT}/.env"
    if [[ ! -f "${SUPABASE_ROOT}/.supabase-version" ]]; then
      cat >"${SUPABASE_ROOT}/.supabase-version" <<EOF_SUPABASE_VERSION
# Supabase self-hosted version stamp. Managed by Spark installation/update.
# Records the exact upstream release used by this runtime.
ref=${latest_ref}
EOF_SUPABASE_VERSION
      chmod 0644 "${SUPABASE_ROOT}/.supabase-version"
    fi
  fi

  SUPABASE_REF="$latest_ref"
  SUPABASE_COMMIT="$latest_commit"
  save_config
  rm -f "${SUPABASE_ROOT}/.spark-supabase-source-commit"

  if run_logged "Validate pinned Supabase source/runtime provenance" test_supabase_source; then
    mark_step 4
  else
    unmark_step 4
    return 1
  fi
}

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
  diff -qr --exclude=main --exclude=deno.jsonc "${SPARK_ROOT}/supabase/functions" "${SUPABASE_ROOT}/volumes/functions" || return 1
  if [[ -f "${SUPABASE_SOURCE}/docker/volumes/functions/deno.jsonc" ]]; then
    cmp -s "${SUPABASE_SOURCE}/docker/volumes/functions/deno.jsonc" "${SUPABASE_ROOT}/volumes/functions/deno.jsonc" || return 1
  fi
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

  if [[ -f "${SUPABASE_SOURCE}/docker/volumes/functions/deno.jsonc" ]]; then
    run_logged "Install pinned Supabase deno.jsonc" \
      install -m 0644 "${SUPABASE_SOURCE}/docker/volumes/functions/deno.jsonc" "${SUPABASE_ROOT}/volumes/functions/deno.jsonc" || return 1
  fi

  run_logged "Install offline-safe Spark Edge Runtime main router" \
    sync_spark_edge_main_router || return 1

  if run_logged "Compatibility test Edge Functions, deno config and offline-safe Main Router" test_function_sync; then
    mark_step 7
  else
    unmark_step 7
    return 1
  fi
}
