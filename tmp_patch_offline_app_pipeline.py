from pathlib import Path

p = Path('deploy/spark-cli/lib/application-maintenance.sh')
s = p.read_text()

old = '''  local target_sha short stage work root output partial created source_ref
  local arch node_version npm_version node_pkg_version node_deb npm_tgz
  run_logged "Fetch latest application source from origin/main" \\
    git -C "$SPARK_ROOT" fetch --prune origin main || return 1
  target_sha="$(git -C "$SPARK_ROOT" rev-parse refs/remotes/origin/main)" || return 1
  [[ "$target_sha" =~ ^[0-9a-f]{40}$ ]] || { fail "Unable to resolve latest origin/main commit."; return 1; }
'''
new = '''  local target_sha short stage work root output partial created source_ref
  local arch node_version npm_version node_pkg_version node_deb npm_tgz
  local shallow bundle_repo verify_repo verified_sha
  shallow="$(git -C "$SPARK_ROOT" rev-parse --is-shallow-repository 2>/dev/null || printf false)"
  if [[ "$shallow" == "true" ]]; then
    run_logged "Unshallow application source history from origin/main" \\
      git -C "$SPARK_ROOT" fetch --prune --unshallow origin main || return 1
  else
    run_logged "Fetch latest application source from origin/main" \\
      git -C "$SPARK_ROOT" fetch --prune origin main || return 1
  fi
  target_sha="$(git -C "$SPARK_ROOT" rev-parse refs/remotes/origin/main)" || return 1
  [[ "$target_sha" =~ ^[0-9a-f]{40}$ ]] || { fail "Unable to resolve latest origin/main commit."; return 1; }
  run_logged "Validate complete application Git history" \\
    bash -c "git -C '$SPARK_ROOT' rev-list --objects '$target_sha' >/dev/null" || {
      fail "Application source history is incomplete; refusing to build an Offline App update."
      return 1
    }
'''
assert s.count(old) == 1, f'fetch block count={s.count(old)}'
s = s.replace(old, new, 1)

old = '  source_ref="refs/remotes/origin/main"\n'
assert s.count(old) == 1, f'source_ref count={s.count(old)}'
s = s.replace(old, '  source_ref="refs/heads/main"\n', 1)

old = '''  cleanup_build_offline_app_update() {
    git -C "$SPARK_ROOT" worktree remove --force "$stage" >/dev/null 2>&1 || true
    rm -rf "$stage" "$work" "$partial"
  }
'''
new = '''  cleanup_build_offline_app_update() {
    git -C "$SPARK_ROOT" worktree remove --force "$stage" >/dev/null 2>&1 || true
    rm -rf "$stage" "$work" "$partial" "${bundle_repo:-}" "${verify_repo:-}"
  }
'''
assert s.count(old) == 1, f'cleanup block count={s.count(old)}'
s = s.replace(old, new, 1)

old = '''  run_logged "Create application source Git bundle" \\
    git -C "$SPARK_ROOT" bundle create "$root/sources/spark.git.bundle" "$source_ref" || return 1
  run_logged "Package frontend dependencies for offline build" \\
    tar -C "$stage" -czf "$root/npm/frontend-node-modules.tar.gz" node_modules || return 1
'''
new = '''  bundle_repo="$(mktemp -d /tmp/spark-app-bundle-source.XXXXXX)" || return 1
  verify_repo="$(mktemp -d /tmp/spark-app-bundle-verify.XXXXXX)" || return 1
  run_logged "Create canonical full-history application bundle source" \\
    git init --bare -q "$bundle_repo" || return 1
  run_logged "Populate full application history for offline bundle" \\
    git -C "$bundle_repo" fetch -q "$SPARK_ROOT" "$target_sha" || return 1
  git -C "$bundle_repo" update-ref refs/heads/main "$target_sha" || return 1
  run_logged "Create full-history application Git bundle" \\
    git -C "$bundle_repo" bundle create "$root/sources/spark.git.bundle" "$source_ref" || return 1

  run_logged "Initialize empty repository for Offline App bundle validation" \\
    git -C "$verify_repo" init -q || return 1
  git -C "$verify_repo" bundle verify "$root/sources/spark.git.bundle" >>"$CURRENT_LOG" 2>&1 || {
    fail "Generated Offline App Git bundle failed bundle verification."
    return 1
  }
  run_logged "Import generated Offline App bundle into empty repository" \\
    git -C "$verify_repo" fetch "$root/sources/spark.git.bundle" "$source_ref" || return 1
  verified_sha="$(git -C "$verify_repo" rev-parse FETCH_HEAD)" || return 1
  [[ "$verified_sha" == "$target_sha" ]] || {
    fail "Generated Offline App bundle revision mismatch."
    return 1
  }
  run_logged "Traverse all reachable objects in generated Offline App bundle" \\
    bash -c "git -C '$verify_repo' rev-list --objects '$verified_sha' >/dev/null" || {
      fail "Generated Offline App bundle is missing reachable Git objects."
      return 1
    }

  run_logged "Package frontend dependencies for offline build" \\
    tar -C "$stage" -czf "$root/npm/frontend-node-modules.tar.gz" node_modules || return 1
'''
assert s.count(old) == 1, f'bundle block count={s.count(old)}'
s = s.replace(old, new, 1)

old = '''  if ! git -C "$verify_repo" bundle verify "${root}/sources/spark.git.bundle" >>"$CURRENT_LOG" 2>&1; then
    rm -rf "$verify_repo"
    fail "Offline App Git bundle is invalid."
    return 1
  fi
  rm -rf "$verify_repo"
'''
new = '''  if ! git -C "$verify_repo" bundle verify "${root}/sources/spark.git.bundle" >>"$CURRENT_LOG" 2>&1; then
    rm -rf "$verify_repo"
    fail "Offline App Git bundle is invalid."
    return 1
  fi
  if ! git -C "$verify_repo" fetch "${root}/sources/spark.git.bundle" "$source_ref" >>"$CURRENT_LOG" 2>&1; then
    rm -rf "$verify_repo"
    fail "Offline App Git bundle is incomplete and cannot be imported into an empty repository."
    return 1
  fi
  if [[ "$(git -C "$verify_repo" rev-parse FETCH_HEAD 2>/dev/null || true)" != "$commit" ]]; then
    rm -rf "$verify_repo"
    fail "Offline App Git bundle revision does not match its manifest."
    return 1
  fi
  if ! git -C "$verify_repo" rev-list --objects "$commit" >/dev/null 2>>"$CURRENT_LOG"; then
    rm -rf "$verify_repo"
    fail "Offline App Git bundle is missing reachable history objects."
    return 1
  fi
  rm -rf "$verify_repo"
'''
assert s.count(old) == 1, f'validator block count={s.count(old)}'
s = s.replace(old, new, 1)

p.write_text(s)
