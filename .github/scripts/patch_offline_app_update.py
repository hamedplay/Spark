from pathlib import Path

path = Path('deploy/spark-cli/lib/application-maintenance.sh')
text = path.read_text()

old_verify = '''  git -C "$SPARK_ROOT" bundle verify "${root}/sources/spark.git.bundle" >>"$CURRENT_LOG" 2>&1 || {
    fail "Offline App Git bundle is invalid."
    return 1
  }
'''
new_verify = '''  local verify_repo
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
'''
if text.count(old_verify) != 1:
    raise SystemExit(f'expected bundle verify block once, found {text.count(old_verify)}')
text = text.replace(old_verify, new_verify, 1)

start = text.find('application_update_offline() (\n')
end = text.find('\napplication_packages_update() (\n', start)
if start < 0 or end < 0:
    raise SystemExit('application_update_offline function boundaries not found')

replacement = r'''application_current_deployed_commit() {
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

  if (( standalone == 1 )) && [[ "$standalone_format" == "2" ]]; then
    node_expected="$(application_offline_update_meta "$root" NODE_VERSION)"
    npm_expected="$(application_offline_update_meta "$root" NPM_VERSION)"
    info "Bundled runtime: Node.js v${node_expected}, npm ${npm_expected}"
    application_install_offline_runtime "$root" || return 1
    ok "Bundled Node.js/npm runtime installed and verified"
  else
    warn "Legacy full Air-Gap fallback selected; Node.js/npm runtime is not changed by this compatibility path."
  fi

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
'''
text = text[:start] + replacement + text[end:]
path.write_text(text)

ui = Path('deploy/spark-cli/spark-ui-core.py')
ui_text = ui.read_text()
old_status = '    status["commit"] = run_quiet(["git", "-C", str(SPARK_ROOT), "rev-parse", "--short=12", "HEAD"], timeout=0.8) or "n/a"\n'
new_status = '''    commit = run_quiet(["git", "-C", str(SPARK_ROOT), "rev-parse", "--short=12", "HEAD"], timeout=0.8)\n    if not commit:\n        try:\n            state_file = STATE_DIR / "application-active.env"\n            for line in state_file.read_text().splitlines():\n                if line.startswith("commit="):\n                    value = line.split("=", 1)[1].strip()\n                    if re.fullmatch(r"[0-9a-f]{40}", value):\n                        commit = value[:12]\n                    break\n        except OSError:\n            pass\n    status["commit"] = commit or "n/a"\n'''
if ui_text.count(old_status) != 1:
    raise SystemExit(f'UI commit status marker count: {ui_text.count(old_status)}')
ui.write_text(ui_text.replace(old_status, new_status, 1))
