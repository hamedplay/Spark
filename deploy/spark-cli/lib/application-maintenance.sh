#!/usr/bin/env bash
# Spark application maintenance actions.
#
# All functions in this module are application-layer only. They must not apply
# SQL migrations, mutate PostgreSQL, update Supabase runtime, synchronize Edge
# Functions, recreate workers/schedulers, or update the Spark Manager.

SPARK_APP_STATE_FILE="${STATE_DIR}/application-active.env"
SPARK_AIRGAP_HOME="${AIRGAP_HOME:-/opt/spark-airgap}"
SPARK_AIRGAP_CURRENT="${SPARK_AIRGAP_HOME}/current"
SPARK_APP_OFFLINE_UPDATE_DIR="${SPARK_APP_OFFLINE_UPDATE_DIR:-/var/backups/spark/application-updates}"

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

application_offline_update_meta() {
  local root="$1" key="$2" manifest="${1}/metadata/manifest.env"
  [[ -f "$manifest" ]] || return 1
  sed -n "s/^${key}=//p" "$manifest" | tail -n1
}

application_validate_offline_update_bundle() {
  local root="$1" format type commit source_ref arch node_version npm_version node_package npm_package
  [[ -d "$root" ]] || { fail "Offline App update directory not found: $root"; return 1; }
  [[ -f "${root}/metadata/manifest.env" ]] || { fail "Offline App update manifest is missing."; return 1; }
  [[ -f "${root}/sources/spark.git.bundle" ]] || { fail "Offline App source bundle is missing."; return 1; }
  [[ -f "${root}/npm/frontend-node-modules.tar.gz" ]] || { fail "Offline App dependency archive is missing."; return 1; }
  [[ -f "${root}/SHA256SUMS" ]] || { fail "Offline App integrity manifest is missing."; return 1; }

  format="$(application_offline_update_meta "$root" FORMAT_VERSION)"
  type="$(application_offline_update_meta "$root" TYPE)"
  commit="$(application_offline_update_meta "$root" SPARK_COMMIT)"
  source_ref="$(application_offline_update_meta "$root" SOURCE_REF)"
  arch="$(application_offline_update_meta "$root" ARCH)"
  node_version="$(application_offline_update_meta "$root" NODE_VERSION)"
  npm_version="$(application_offline_update_meta "$root" NPM_VERSION)"
  node_package="$(application_offline_update_meta "$root" NODE_PACKAGE)"
  npm_package="$(application_offline_update_meta "$root" NPM_PACKAGE)"

  [[ "$format" == "2" && "$type" == "application-update" ]] || {
    fail "Unsupported Offline App update format. Expected runtime-complete format v2."
    return 1
  }
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { fail "Offline App SPARK_COMMIT is invalid."; return 1; }
  [[ -n "$source_ref" ]] || { fail "Offline App SOURCE_REF is missing."; return 1; }
  [[ -n "$arch" && "$arch" == "$(dpkg --print-architecture)" ]] || {
    fail "Offline App architecture mismatch: package=${arch:-unknown} host=$(dpkg --print-architecture)."
    return 1
  }
  [[ "$node_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { fail "Offline App NODE_VERSION is invalid."; return 1; }
  [[ "$npm_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-].*)?$ ]] || { fail "Offline App NPM_VERSION is invalid."; return 1; }
  [[ -n "$node_package" && -f "${root}/runtime/node/${node_package}" ]] || { fail "Offline App Node.js package is missing."; return 1; }
  [[ -n "$npm_package" && -f "${root}/runtime/npm/${npm_package}" ]] || { fail "Offline App npm package is missing."; return 1; }

  run_logged "Verify Offline App update integrity" \
    bash -c "cd '$root' && sha256sum --quiet -c SHA256SUMS" || return 1
  local verify_repo
  verify_repo="$(mktemp -d /tmp/spark-app-bundle-verify.XXXXXX)" || return 1
  if ! git -C "$verify_repo" init -q >>"$CURRENT_LOG" 2>&1; then
    rm -rf "$verify_repo"
    fail "Unable to initialize temporary repository for Offline App bundle validation."
    return 1
  fi
  if ! git -C "$verify_repo" bundle verify "${root}/sources/spark.git.bundle" >>"$CURRENT_LOG" 2>&1; then
    rm -rf "$verify_repo"
    fail "Offline App Git bundle is invalid."
    return 1
  fi
  rm -rf "$verify_repo"
}

application_install_offline_runtime() {
  local root="$1" node_version npm_version node_package npm_package node_deb npm_tgz
  node_version="$(application_offline_update_meta "$root" NODE_VERSION)"
  npm_version="$(application_offline_update_meta "$root" NPM_VERSION)"
  node_package="$(application_offline_update_meta "$root" NODE_PACKAGE)"
  npm_package="$(application_offline_update_meta "$root" NPM_PACKAGE)"
  node_deb="${root}/runtime/node/${node_package}"
  npm_tgz="${root}/runtime/npm/${npm_package}"

  run_logged "Install bundled Node.js ${node_version}" dpkg -i "$node_deb" || {
    fail "Bundled Node.js package installation failed. No network repair is attempted in Offline App mode."
    return 1
  }
  [[ "$(node --version 2>/dev/null || true)" == "v${node_version}" ]] || {
    fail "Node.js version verification failed after offline install: expected=v${node_version} actual=$(node --version 2>/dev/null || printf unavailable)"
    return 1
  }

  run_logged "Install bundled npm ${npm_version}" \
    npm install -g "$npm_tgz" --offline --no-audit --no-fund || return 1
  [[ "$(npm --version 2>/dev/null || true)" == "$npm_version" ]] || {
    fail "npm version verification failed after offline install: expected=${npm_version} actual=$(npm --version 2>/dev/null || printf unavailable)"
    return 1
  }
}

application_build_offline_update() (
  title
  new_log "build-offline-app-update"

  command -v git >/dev/null 2>&1 || { fail "git is not installed."; return 1; }
  command -v node >/dev/null 2>&1 || { fail "Node.js is not installed."; return 1; }
  command -v npm >/dev/null 2>&1 || { fail "npm is not installed."; return 1; }
  command -v tar >/dev/null 2>&1 || { fail "tar is not installed."; return 1; }
  command -v sha256sum >/dev/null 2>&1 || { fail "sha256sum is not installed."; return 1; }
  command -v dpkg >/dev/null 2>&1 || { fail "dpkg is not installed."; return 1; }
  command -v apt-get >/dev/null 2>&1 || { fail "apt-get is not installed."; return 1; }
  [[ -d "${SPARK_ROOT}/.git" ]] || { fail "Spark source repository not found: ${SPARK_ROOT}"; return 1; }

  local target_sha short stage work root output partial created source_ref
  local arch node_version npm_version node_pkg_version node_deb npm_tgz
  run_logged "Fetch latest application source from origin/main" \
    git -C "$SPARK_ROOT" fetch --prune origin main || return 1
  target_sha="$(git -C "$SPARK_ROOT" rev-parse refs/remotes/origin/main)" || return 1
  [[ "$target_sha" =~ ^[0-9a-f]{40}$ ]] || { fail "Unable to resolve latest origin/main commit."; return 1; }

  arch="$(dpkg --print-architecture)"
  node_version="$(node --version | sed 's/^v//')"
  npm_version="$(npm --version)"
  node_pkg_version="$(dpkg-query -W -f='${Version}' nodejs 2>/dev/null || true)"
  [[ "$node_version" =~ ^24\.[0-9]+\.[0-9]+$ ]] || {
    fail "Offline App builder requires the supported Node 24.x runtime; active Node.js is v${node_version}."
    return 1
  }
  [[ "$npm_version" =~ ^12\.[0-9]+\.[0-9]+([+-].*)?$ ]] || {
    fail "Offline App builder requires the supported npm 12.x runtime; active npm is ${npm_version}."
    return 1
  }
  [[ -n "$node_pkg_version" ]] || {
    fail "Active Node.js is not backed by the Debian nodejs package; exact offline runtime packaging is unavailable."
    return 1
  }

  short="${target_sha:0:12}"
  source_ref="refs/remotes/origin/main"
  stage="/opt/spark-app-update-build-${short}-$$"
  work="$(mktemp -d /tmp/spark-app-update.XXXXXX)" || return 1
  root="${work}/spark-app-update-${short}"
  output="${SPARK_APP_OFFLINE_UPDATE_DIR}/spark-app-update-${short}.tar.gz"
  partial="${output}.partial.$$"

  cleanup_build_offline_app_update() {
    git -C "$SPARK_ROOT" worktree remove --force "$stage" >/dev/null 2>&1 || true
    rm -rf "$stage" "$work" "$partial"
  }
  trap cleanup_build_offline_app_update EXIT

  rm -rf "$stage"
  mkdir -p "$root/metadata" "$root/sources" "$root/npm" \
    "$root/runtime/node" "$root/runtime/npm" "$SPARK_APP_OFFLINE_UPDATE_DIR"
  chmod 0700 "$SPARK_APP_OFFLINE_UPDATE_DIR"

  run_logged "Create application update staging worktree" \
    git -C "$SPARK_ROOT" worktree add --detach "$stage" "$target_sha" || return 1
  run_logged "Install locked application dependencies" \
    bash -c "cd '$stage' && npm ci --no-audit --no-fund" || return 1
  run_logged "Validate application build before packaging" \
    bash -c "cd '$stage' && VITE_SUPABASE_URL=http://127.0.0.1 VITE_SUPABASE_ANON_KEY=offline-build-validation npm run build" || return 1

  run_logged "Create application source Git bundle" \
    git -C "$SPARK_ROOT" bundle create "$root/sources/spark.git.bundle" "$source_ref" || return 1
  run_logged "Package frontend dependencies for offline build" \
    tar -C "$stage" -czf "$root/npm/frontend-node-modules.tar.gz" node_modules || return 1

  run_logged "Download exact active Node.js Debian package" \
    bash -c "cd '$root/runtime/node' && apt-get download 'nodejs=${node_pkg_version}'" || {
      fail "Unable to download the exact active Node.js package (${node_pkg_version}). Refresh/configure the NodeSource repository, then retry."
      return 1
    }
  node_deb="$(find "$root/runtime/node" -maxdepth 1 -type f -name 'nodejs_*.deb' -print -quit)"
  [[ -f "$node_deb" ]] || { fail "Downloaded Node.js .deb was not found."; return 1; }

  run_logged "Package exact active npm release" \
    npm pack "npm@${npm_version}" --pack-destination "$root/runtime/npm" >/dev/null || return 1
  npm_tgz="$(find "$root/runtime/npm" -maxdepth 1 -type f -name 'npm-*.tgz' -print -quit)"
  [[ -f "$npm_tgz" ]] || { fail "Packed npm archive was not found."; return 1; }

  created="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  cat >"$root/metadata/manifest.env" <<EOF_APP_UPDATE
FORMAT_VERSION=2
TYPE=application-update
SPARK_COMMIT=$target_sha
SOURCE_REF=$source_ref
CREATED_AT=$created
ARCH=$arch
NODE_VERSION=$node_version
NODE_DEB_VERSION=$node_pkg_version
NPM_VERSION=$npm_version
NODE_PACKAGE=$(basename "$node_deb")
NPM_PACKAGE=$(basename "$npm_tgz")
EOF_APP_UPDATE

  (cd "$root" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS) || return 1
  run_logged "Create runtime-complete Offline App update archive" \
    tar -C "$work" -czf "$partial" "$(basename "$root")" || return 1
  chmod 0600 "$partial"
  mv -f "$partial" "$output" || return 1

  ok "Runtime-complete Offline App update package created."
  printf 'Application commit : %s
' "$target_sha"
  printf 'Node.js            : v%s (%s)
' "$node_version" "$node_pkg_version"
  printf 'npm                : %s
' "$npm_version"
  printf 'Architecture       : %s
' "$arch"
  printf 'Output             : %s
' "$output"
  printf 'Scope              : App source + Node.js + npm + build dependencies; no DB/Supabase/Linux/Manager update
'
  printf 'Log                : %s
' "$CURRENT_LOG"
)

application_current_deployed_commit() {
  local commit="" airgap_root=""

  if [[ -f "$SPARK_APP_STATE_FILE" ]]; then
    commit="$(sed -n 's/^commit=//p' "$SPARK_APP_STATE_FILE" | tail -n1)"
  fi
  if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]] && [[ -d "${SPARK_ROOT}/.git" ]]; then
    commit="$(git -C "$SPARK_ROOT" rev-parse HEAD 2>/dev/null || true)"
  fi
  if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]] && [[ -L "$SPARK_AIRGAP_CURRENT" || -d "$SPARK_AIRGAP_CURRENT" ]]; then
    airgap_root="$(readlink -f "$SPARK_AIRGAP_CURRENT" 2>/dev/null || true)"
    if [[ -n "$airgap_root" ]]; then
      commit="$(application_airgap_meta "$airgap_root" SPARK_COMMIT 2>/dev/null || true)"
    fi
  fi

  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || return 1
  printf '%s\n' "$commit"
}

application_update_offline() (
  title
  new_log "update-offline-app"

  command -v git >/dev/null 2>&1 || { fail "git is required for Offline App update."; return 1; }
  command -v tar >/dev/null 2>&1 || { fail "tar is required for Offline App update."; return 1; }
  [[ -f "${SUPABASE_ROOT}/.env" ]] || { fail "Supabase environment is required only to read the existing frontend ANON_KEY."; return 1; }

  local source_available=0 source_old_sha=""
  if [[ -d "${SPARK_ROOT}/.git" ]]; then
    source_available=1
    if [[ -n "$(git -C "$SPARK_ROOT" status --porcelain)" ]]; then
      fail "Spark source has uncommitted changes; Offline App update stopped."
      git -C "$SPARK_ROOT" status --short | tee -a "$CURRENT_LOG"
      return 1
    fi
    source_old_sha="$(git -C "$SPARK_ROOT" rev-parse HEAD)" || return 1
  else
    info "Local Spark source checkout is absent; Offline App update will use the bundled source in an isolated staging repository."
  fi

  local input extract_root="" root bundle node_archive target_sha old_sha fetched_sha stage source_ref
  local modules_next="" modules_prev="" node_expected npm_expected standalone_format
  local source_advanced=0 modules_switched=0 update_success=0 standalone=0
  read -r -p "Offline App update .tar.gz/directory (Enter = active full Air-Gap bundle): " input

  if [[ -n "$input" ]]; then
    standalone=1
    if [[ -d "$input" ]]; then
      root="$(readlink -f "$input")"
    elif [[ -f "$input" ]]; then
      extract_root="$(mktemp -d /tmp/spark-app-update-install.XXXXXX)" || return 1
      tar -xzf "$input" -C "$extract_root" || { rm -rf "$extract_root"; fail "Unable to extract Offline App update archive."; return 1; }
      root="$(find "$extract_root" -mindepth 1 -maxdepth 1 -type d -name 'spark-app-update-*' -print -quit)"
      [[ -n "$root" ]] || { rm -rf "$extract_root"; fail "Offline App update root was not found in archive."; return 1; }
    else
      fail "Offline App update path not found: $input"
      return 1
    fi
    application_validate_offline_update_bundle "$root" || { [[ -z "$extract_root" ]] || rm -rf "$extract_root"; return 1; }
    source_ref="$(application_offline_update_meta "$root" SOURCE_REF)"
    target_sha="$(application_offline_update_meta "$root" SPARK_COMMIT)"
    standalone_format="$(application_offline_update_meta "$root" FORMAT_VERSION)"
  else
    root="$(application_active_airgap_root)" || return 1
    source_ref="main"
    target_sha="$(application_airgap_meta "$root" SPARK_COMMIT)"
    standalone_format="0"
  fi

  bundle="${root}/sources/spark.git.bundle"
  node_archive="${root}/npm/frontend-node-modules.tar.gz"
  [[ -f "$bundle" ]] || { fail "Offline App source bundle is missing: $bundle"; return 1; }
  [[ -f "$node_archive" ]] || { fail "Offline App frontend dependency archive is missing: $node_archive"; return 1; }
  [[ "$target_sha" =~ ^[0-9a-f]{40}$ ]] || { fail "Offline App SPARK_COMMIT is invalid."; return 1; }

  old_sha="$(application_current_deployed_commit 2>/dev/null || true)"
  if [[ "$old_sha" =~ ^[0-9a-f]{40}$ ]]; then
    info "Current deployed application revision: $old_sha"
  else
    old_sha=""
    warn "Current deployed application revision metadata is unavailable; bundle integrity is verified, but fast-forward lineage cannot be proven."
  fi

  stage="/opt/spark-app-offline-${target_sha:0:12}-$$"
  rm -rf "$stage"
  if (( source_available == 1 )); then
    modules_next="${SPARK_ROOT}/node_modules.next.$$"
    modules_prev="${SPARK_ROOT}/node_modules.prev.$$"
    rm -rf "$modules_next" "$modules_prev"
  fi

  cleanup_offline_app() {
    rm -rf "$stage"
    if (( source_available == 1 )); then
      rm -rf "$modules_next"
      if (( update_success == 1 || modules_switched == 0 )); then
        rm -rf "$modules_prev"
      fi
    fi
    [[ -z "$extract_root" ]] || rm -rf "$extract_root"
  }
  rollback_offline_source_and_modules() {
    if (( source_available == 1 && modules_switched == 1 )); then
      rm -rf "${SPARK_ROOT}/node_modules"
      [[ -d "$modules_prev" ]] && mv "$modules_prev" "${SPARK_ROOT}/node_modules" || true
      modules_switched=0
    fi
    if (( source_available == 1 && source_advanced == 1 )); then
      git -C "$SPARK_ROOT" reset --hard "$source_old_sha" >>"$CURRENT_LOG" 2>&1 || true
      source_advanced=0
    fi
  }
  trap cleanup_offline_app EXIT
  trap 'rollback_offline_source_and_modules; exit 130' INT TERM

  run_logged "Initialize isolated Offline App staging repository" git init -q "$stage" || return 1
  run_logged "Fetch offline application revision into staging" \
    git -C "$stage" fetch "$bundle" "$source_ref" || return 1
  fetched_sha="$(git -C "$stage" rev-parse FETCH_HEAD)" || return 1
  [[ "$fetched_sha" == "$target_sha" ]] || {
    fail "Offline App manifest/source revision mismatch."
    return 1
  }

  if [[ -n "$old_sha" && "$old_sha" != "$target_sha" ]]; then
    if ! git -C "$stage" cat-file -e "${old_sha}^{commit}" 2>/dev/null; then
      fail "Offline App bundle does not contain the currently deployed revision; refusing an unverifiable update."
      return 1
    fi
    if ! git -C "$stage" merge-base --is-ancestor "$old_sha" "$target_sha"; then
      fail "Offline application bundle is not a fast-forward from the currently deployed application revision."
      return 1
    fi
  fi

  if (( standalone == 1 )) && [[ "$standalone_format" == "2" ]]; then
    node_expected="$(application_offline_update_meta "$root" NODE_VERSION)"
    npm_expected="$(application_offline_update_meta "$root" NPM_VERSION)"
    info "Bundled runtime: Node.js v${node_expected}, npm ${npm_expected}"
    application_install_offline_runtime "$root" || return 1
    ok "Bundled Node.js/npm runtime installed and verified"
  else
    warn "Legacy full Air-Gap fallback selected; Node.js/npm runtime is not changed by this compatibility path."
  fi

  run_logged "Checkout offline application revision" \
    git -C "$stage" checkout --detach "$target_sha" || return 1
  run_logged "Restore bundled frontend dependencies" \
    tar -xzf "$node_archive" -C "$stage" || return 1
  run_logged "Prepare production frontend environment" \
    application_prepare_frontend_env "$stage" || return 1
  run_logged "Build offline application with bundled dependencies" \
    bash -c "cd '$stage' && npm_config_offline=true npm_config_audit=false npm_config_fund=false npm run build" || return 1
  run_logged "Validate offline application build" \
    application_validate_frontend_build "$stage" || return 1

  if (( source_available == 1 )); then
    run_logged "Fetch offline revision into retained local source" \
      git -C "$SPARK_ROOT" fetch "$bundle" "$source_ref" || return 1
    fetched_sha="$(git -C "$SPARK_ROOT" rev-parse FETCH_HEAD)" || return 1
    [[ "$fetched_sha" == "$target_sha" ]] || {
      fail "Retained source fetch does not match Offline App manifest revision."
      return 1
    }
    if [[ "$source_old_sha" != "$target_sha" ]]; then
      if ! git -C "$SPARK_ROOT" merge-base --is-ancestor "$source_old_sha" "$target_sha"; then
        fail "Offline application bundle is not a fast-forward from the retained local source."
        return 1
      fi
      run_logged "Fast-forward retained local application source" \
        git -C "$SPARK_ROOT" merge --ff-only "$target_sha" || return 1
      source_advanced=1
    fi

    mkdir -p "$modules_next"
    run_logged "Stage bundled application dependencies for retained source" \
      rsync -a --delete "${stage}/node_modules/" "$modules_next/" || return 1
    if [[ -d "${SPARK_ROOT}/node_modules" ]]; then
      mv "${SPARK_ROOT}/node_modules" "$modules_prev" || {
        rollback_offline_source_and_modules
        fail "Unable to stage previous application dependencies for rollback."
        return 1
      }
    fi
    if ! mv "$modules_next" "${SPARK_ROOT}/node_modules"; then
      [[ -d "$modules_prev" ]] && mv "$modules_prev" "${SPARK_ROOT}/node_modules" || true
      rollback_offline_source_and_modules
      fail "Unable to activate bundled application dependencies in retained source."
      return 1
    fi
    modules_switched=1
  fi

  if ! application_activate_dist "$stage"; then
    rollback_offline_source_and_modules
    return 1
  fi

  application_record_active_version "offline" "$target_sha"
  update_success=1
  if (( source_available == 1 )); then
    rm -rf "$modules_prev"
    modules_switched=0
  fi
  ok "Offline App update completed from bundled source. A local /opt/spark checkout is optional; Database, migrations, Supabase runtime, Edge Functions, workers, schedulers and Manager were not changed."
  printf 'Application commit: %s\n' "$target_sha"
  printf 'Node.js           : %s\n' "$(node --version)"
  printf 'npm               : %s\n' "$(npm --version)"
  if (( standalone == 1 )); then
    printf 'Update package    : %s\n' "${input}"
  else
    printf 'Air-Gap bundle    : %s\n' "$(basename "$root")"
  fi
  printf 'Source checkout   : %s\n' "$([[ $source_available -eq 1 ]] && printf retained || printf not-required)"
  printf 'Log               : %s\n' "$CURRENT_LOG"
)

application_packages_update() (
  title
  new_log "packages-update-app"

  [[ -d "${SPARK_ROOT}/.git" ]] || { fail "Spark source repository not found."; return 1; }
  [[ -f "${SPARK_ROOT}/package.json" && -f "${SPARK_ROOT}/package-lock.json" ]] || {
    fail "Application package metadata is incomplete."
    return 1
  }
  [[ -f "${SUPABASE_ROOT}/.env" ]] || { fail "Supabase environment is required only to read the existing frontend ANON_KEY."; return 1; }
  if [[ -n "$(git -C "$SPARK_ROOT" status --porcelain)" ]]; then
    fail "Spark source has uncommitted changes; Update App Packages stopped."
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
  ok "Update App Packages completed in staging and deployed. Source package.json/package-lock.json were not modified."
  printf 'Application commit: %s\n' "$sha"
  printf 'Log: %s\n' "$CURRENT_LOG"
)

application_node_update() {
  title
  new_log "node-update-app"
  command -v node >/dev/null 2>&1 || { fail "Node.js is not installed."; return 1; }
  command -v npm >/dev/null 2>&1 || { fail "npm is not installed."; return 1; }

  local node_before node_after npm_before npm_after candidate installed_pkg
  node_before="$(node --version)"
  npm_before="$(npm --version)"
  info "Current Node.js: $node_before"
  info "Preserved npm  : $npm_before"

  run_logged "Refresh Linux package metadata for Node.js" apt-get update || return 1
  candidate="$(apt-cache policy nodejs 2>/dev/null | awk '/Candidate:/ {print $2; exit}')"
  [[ -n "$candidate" && "$candidate" != "(none)" ]] || {
    fail "No Node.js package candidate is available from configured APT repositories."
    return 1
  }
  if [[ ! "$candidate" =~ (^|:)24\. ]]; then
    fail "Configured Node.js candidate is outside the supported Node 24.x track: $candidate"
    return 1
  fi

  info "Latest Node.js package candidate: $candidate"
  run_logged "Update Node.js to latest available 24.x package" \
    apt-get install -y --only-upgrade nodejs || return 1

  node_after="$(node --version)"
  if ! node -e 'const [M]=process.versions.node.split(".").map(Number); if (M !== 24) process.exit(1)'; then
    fail "Updated Node.js left the supported Node 24.x track."
    node --version | tee -a "$CURRENT_LOG"
    return 1
  fi

  installed_pkg="$(dpkg-query -W -f='${Version}' nodejs 2>/dev/null || true)"
  if [[ -n "$installed_pkg" ]] && ! dpkg --compare-versions "$installed_pkg" ge "$candidate"; then
    fail "Node.js package did not reach the latest configured candidate: installed=$installed_pkg candidate=$candidate"
    return 1
  fi

  npm_after="$(npm --version)"
  if [[ "$npm_after" != "$npm_before" ]]; then
    warn "The Node.js package changed bundled npm ($npm_before -> $npm_after); restoring the previous npm version to preserve action separation."
    run_logged "Restore npm version after Node-only update" npm install -g "npm@${npm_before}" || return 1
    npm_after="$(npm --version)"
  fi
  [[ "$npm_after" == "$npm_before" ]] || {
    fail "Node update changed npm unexpectedly: before=$npm_before after=$npm_after"
    return 1
  }

  ok "Node.js updated to the latest available supported 24.x version; npm was preserved."
  printf 'Node before: %s\nNode after : %s\nnpm         : %s (unchanged)\n' \
    "$node_before" "$node_after" "$npm_after"
}

application_npm_update() {
  title
  new_log "npm-update-app"
  command -v node >/dev/null 2>&1 || { fail "Node.js is not installed."; return 1; }
  command -v npm >/dev/null 2>&1 || { fail "npm is not installed."; return 1; }
  command -v python3 >/dev/null 2>&1 || { fail "python3 is required to resolve the latest npm release."; return 1; }

  local node_before node_after npm_before npm_after latest
  node_before="$(node --version)"
  npm_before="$(npm --version)"
  info "Preserved Node.js: $node_before"
  info "Current npm      : $npm_before"

  latest="$(npm view 'npm@12' version --json 2>>"$CURRENT_LOG" | python3 -c '
import json, re, sys
data=json.load(sys.stdin)
if isinstance(data, str):
    data=[data]
versions=[]
for value in data:
    m=re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:[-+].*)?", value)
    if m and int(m.group(1)) == 12:
        versions.append((tuple(map(int, m.groups()[:3])), value))
if not versions:
    raise SystemExit(1)
print(max(versions)[1])
')" || {
    fail "Unable to resolve the latest npm 12.x release from the npm registry."
    return 1
  }

  info "Latest supported npm release: $latest"
  run_logged "Update npm CLI to latest 12.x" npm install -g "npm@${latest}" || return 1

  npm_after="$(npm --version)"
  [[ "$npm_after" == "$latest" ]] || {
    fail "npm did not reach the resolved latest release: expected=$latest actual=$npm_after"
    return 1
  }

  node_after="$(node --version)"
  [[ "$node_after" == "$node_before" ]] || {
    fail "npm update changed Node.js unexpectedly: before=$node_before after=$node_after"
    return 1
  }

  ok "npm updated to the latest supported 12.x release; Node.js was preserved."
  printf 'npm before : %s\nnpm after  : %s\nNode.js    : %s (unchanged)\n' \
    "$npm_before" "$npm_after" "$node_after"
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

application_optimize_nginx_gzip() {
  title
  new_log "application-nginx-gzip"

  command -v nginx >/dev/null 2>&1 || {
    fail "Nginx is not installed."
    return 1
  }

  run_logged "Apply Nginx gzip performance profile" spark_apply_nginx_gzip_profile || return 1
  run_logged "Validate Nginx configuration" nginx -t || return 1
  run_logged "Reload Nginx" systemctl reload nginx || return 1

  if ! run_logged "Verify effective Nginx gzip profile" spark_nginx_gzip_profile_present; then
    fail "Nginx reloaded, but the expected gzip profile is not active."
    return 1
  fi

  ok "Nginx gzip optimization is active for text-based frontend assets."
  printf 'Compressed types: HTML(default), CSS, JavaScript, JSON, XML, SVG, web manifest\n'
  printf 'Excluded       : PNG/JPEG/WebP/WOFF2 (already compressed formats)\n'
  printf 'Log            : %s\n' "$CURRENT_LOG"
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
