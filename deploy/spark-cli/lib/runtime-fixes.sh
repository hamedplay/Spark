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

# Apply the Internet same-origin migration after legacy update/Nginx functions
# are loaded so these definitions become the active runtime behavior.
source "${SCRIPT_DIR}/lib/same-origin.sh"

# Application updates are a separate layer. Load this after the legacy update
# module so app-update cannot mutate PostgreSQL, Supabase runtime, Functions,
# workers, schedulers or the Manager control plane.
source "${SCRIPT_DIR}/lib/application.sh"
source "${SCRIPT_DIR}/lib/application-maintenance.sh"

# The supported application build/runtime contract is Node.js 24.x + npm 12.x.
# Repair accidental runtime drift (for example a NodeSource major switch to 26.x)
# before building a runtime-complete Offline App package, and keep the explicit
# "Node update app" action constrained to the supported 24.x line.
application_latest_node24_candidate() {
  apt-cache madison nodejs 2>/dev/null \
    | awk '$3 ~ /^24\.[0-9]+\.[0-9]+/ {print $3}' \
    | sort -V \
    | tail -n1
}

application_configure_nodesource_24() {
  command -v curl >/dev/null 2>&1 || { fail "curl is required to configure the supported NodeSource repository."; return 1; }
  command -v gpg >/dev/null 2>&1 || { fail "gpg is required to configure the supported NodeSource repository."; return 1; }

  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -s /etc/apt/keyrings/nodesource.gpg ]]; then
    run_logged "Install NodeSource signing key" bash -c \
      'curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg' || return 1
    chmod a+r /etc/apt/keyrings/nodesource.gpg
  fi

  printf '%s\n' \
    'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main' \
    >/etc/apt/sources.list.d/nodesource.list
}

application_resolve_node24_candidate() {
  APPLICATION_NODE24_CANDIDATE="$(application_latest_node24_candidate)"
  if [[ -n "$APPLICATION_NODE24_CANDIDATE" ]]; then
    return 0
  fi

  info "No Node.js 24.x package is currently visible; restoring the canonical NodeSource 24.x repository."
  application_configure_nodesource_24 || return 1
  run_logged "Refresh package metadata for Node.js 24.x" apt-get update || return 1
  APPLICATION_NODE24_CANDIDATE="$(application_latest_node24_candidate)"
  [[ -n "$APPLICATION_NODE24_CANDIDATE" ]] || {
    fail "No supported Node.js 24.x package is available after restoring the NodeSource 24.x repository."
    return 1
  }
}

application_install_supported_node24() {
  local preserve_npm="${1:-false}" npm_before="" npm_after=""
  if [[ "$preserve_npm" == "true" ]]; then
    npm_before="$(npm --version 2>/dev/null || true)"
  fi

  run_logged "Refresh Linux package metadata for supported Node.js" apt-get update || return 1
  application_resolve_node24_candidate || return 1
  info "Supported Node.js 24.x package candidate: $APPLICATION_NODE24_CANDIDATE"
  run_logged "Install supported Node.js 24.x package" \
    apt-get install -y --allow-downgrades "nodejs=${APPLICATION_NODE24_CANDIDATE}" || return 1
  hash -r

  node -e 'const [M]=process.versions.node.split(".").map(Number); if (M !== 24) process.exit(1)' || {
    fail "Node.js runtime reconciliation failed: expected 24.x, actual $(node --version 2>/dev/null || printf unavailable)."
    return 1
  }

  if [[ "$preserve_npm" == "true" && -n "$npm_before" ]]; then
    npm_after="$(npm --version 2>/dev/null || true)"
    if [[ "$npm_after" != "$npm_before" ]]; then
      run_logged "Restore preserved npm ${npm_before}" \
        npm install -g "npm@${npm_before}" --no-audit --no-fund || return 1
    fi
  fi
}

application_prepare_offline_builder_runtime() {
  local node_version npm_version
  node_version="$(node --version 2>/dev/null | sed 's/^v//' || true)"
  npm_version="$(npm --version 2>/dev/null || true)"

  if [[ ! "$node_version" =~ ^24\.[0-9]+\.[0-9]+$ ]]; then
    warn "Offline App builder runtime drift detected: Node.js v${node_version:-unavailable}; restoring supported Node.js 24.x."
    application_install_supported_node24 false || return 1
  fi

  npm_version="$(npm --version 2>/dev/null || true)"
  if [[ ! "$npm_version" =~ ^12\.[0-9]+\.[0-9]+([+-].*)?$ ]]; then
    warn "Offline App builder runtime drift detected: npm ${npm_version:-unavailable}; restoring supported npm 12.x."
    run_logged "Install supported npm 12.x runtime" \
      npm install -g 'npm@12' --no-audit --no-fund || return 1
    hash -r
  fi

  node -e 'const [M]=process.versions.node.split(".").map(Number); if (M !== 24) process.exit(1)' || return 1
  [[ "$(npm --version)" =~ ^12\.[0-9]+\.[0-9]+([+-].*)?$ ]] || return 1
}

# Preserve the canonical implementation, then wrap it with runtime reconciliation.
if declare -F application_build_offline_update >/dev/null 2>&1; then
  eval "$(declare -f application_build_offline_update | sed '1s/application_build_offline_update/application_build_offline_update_base/')"
fi

application_build_offline_update() {
  local node_version npm_version
  node_version="$(node --version 2>/dev/null | sed 's/^v//' || true)"
  npm_version="$(npm --version 2>/dev/null || true)"

  if [[ ! "$node_version" =~ ^24\.[0-9]+\.[0-9]+$ || ! "$npm_version" =~ ^12\.[0-9]+\.[0-9]+([+-].*)?$ ]]; then
    title
    new_log "repair-offline-app-builder-runtime"
    application_prepare_offline_builder_runtime || return 1
  fi

  application_build_offline_update_base
}

application_node_update() {
  title
  new_log "node-update-app"
  command -v node >/dev/null 2>&1 || { fail "Node.js is not installed."; return 1; }
  command -v npm >/dev/null 2>&1 || { fail "npm is not installed."; return 1; }
  command -v apt-get >/dev/null 2>&1 || { fail "apt-get is not installed."; return 1; }

  local node_before npm_before node_after npm_after
  node_before="$(node --version)"
  npm_before="$(npm --version)"
  info "Current Node.js: $node_before"
  info "Preserved npm  : $npm_before"

  application_install_supported_node24 true || return 1

  node_after="$(node --version)"
  npm_after="$(npm --version)"
  [[ "$npm_after" == "$npm_before" ]] || {
    fail "Node update changed npm unexpectedly: before=$npm_before after=$npm_after"
    return 1
  }
  printf 'Node before: %s\nNode after : %s\nnpm        : %s (unchanged)\n' \
    "$node_before" "$node_after" "$npm_after"
}

# Linux host maintenance is kept separate from application/database operations.
source "${SCRIPT_DIR}/lib/linux-system.sh"

# Database migrations are a separate layer as well. Application updates never
# source or call this updater; it is exposed only through the Database menu.
source "${SCRIPT_DIR}/lib/database.sh"

# Load the shared Spark CLI progress renderer late so all normal runtime paths
# use the same activity/progress UI without duplicating logic in each module.
source "${SCRIPT_DIR}/lib/progress-ui.sh"
