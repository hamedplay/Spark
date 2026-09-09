# Automatic Air-Gap target preparation/bootstrap workflow.
# Sourced after airgap-target-patch.sh by spark-airgap.

AIRGAP_AUTO_TRANSFER_DIR="${AIRGAP_AUTO_TRANSFER_DIR:-/opt/install}"

airgap_auto_patch_meta() {
  local input="$1" key="$2" member
  if [[ -d "$input" ]]; then
    airgap_target_patch_meta_from "$input" "$key"
    return
  fi
  [[ -f "$input" ]] || return 1
  member="$(tar -tzf "$input" 2>/dev/null | awk '/\/metadata\/patch\.env$/ {print; exit}')"
  [[ -n "$member" ]] || return 1
  tar -xOf "$input" "$member" 2>/dev/null | sed -n "s/^${key}=//p" | tail -n1
}

airgap_auto_resolve_named_file() {
  local value="$1" d
  [[ -n "$value" ]] || return 1
  if [[ -f "$value" || -d "$value" ]]; then
    readlink -f "$value"
    return 0
  fi
  for d in "$AIRGAP_AUTO_TRANSFER_DIR" /var/backups/spark-airgap "$PWD"; do
    [[ -d "$d" ]] || continue
    if [[ -f "$d/$value" || -d "$d/$value" ]]; then
      readlink -f "$d/$value"
      return 0
    fi
  done
  return 1
}

airgap_auto_find_patch() {
  local requested="${1:-}" resolved target_release target_arch d row path target arch
  if [[ -n "$requested" ]]; then
    resolved="$(airgap_auto_resolve_named_file "$requested")" || {
      fail "Ubuntu target patch not found: $requested"
      return 1
    }
    printf '%s\n' "$resolved"
    return 0
  fi

  . /etc/os-release
  target_release="${VERSION_ID:-}"
  target_arch="$(dpkg --print-architecture)"

  while IFS= read -r row; do
    path="${row#* }"
    [[ -f "$path" ]] || continue
    target="$(airgap_auto_patch_meta "$path" TARGET_UBUNTU_VERSION 2>/dev/null || true)"
    arch="$(airgap_auto_patch_meta "$path" ARCH 2>/dev/null || true)"
    if [[ "$target" == "$target_release" && "$arch" == "$target_arch" ]]; then
      readlink -f "$path"
      return 0
    fi
  done < <(
    for d in "$AIRGAP_AUTO_TRANSFER_DIR" /var/backups/spark-airgap "$PWD"; do
      [[ -d "$d" ]] || continue
      find "$d" -maxdepth 1 -type f -name 'spark-airgap-target-patch-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null
    done | sort -nr
  )

  fail "No target patch matching Ubuntu ${target_release:-unknown}/${target_arch:-unknown} was found in ${AIRGAP_AUTO_TRANSFER_DIR}, /var/backups/spark-airgap or the current directory."
  return 1
}

airgap_auto_find_base() {
  local patch="$1" requested="${2:-}" base_id resolved d
  base_id="$(airgap_auto_patch_meta "$patch" BASE_BUNDLE_ID 2>/dev/null || true)"
  [[ -n "$base_id" ]] || { fail "Target patch does not contain BASE_BUNDLE_ID metadata."; return 1; }

  if [[ -n "$requested" ]]; then
    resolved="$(airgap_auto_resolve_named_file "$requested" 2>/dev/null || true)"
    if [[ -n "$resolved" ]]; then
      if [[ -f "$resolved" ]]; then
        printf '%s\n' "$resolved"
        return 0
      fi
      if [[ -d "$resolved" && -f "$resolved/metadata/manifest.env" ]]; then
        printf '%s\n' "$resolved"
        return 0
      fi
      if [[ -d "$resolved" ]]; then
        [[ -f "$resolved/${base_id}.tar.gz" ]] && { readlink -f "$resolved/${base_id}.tar.gz"; return 0; }
        [[ -d "$resolved/${base_id}" && -f "$resolved/${base_id}/metadata/manifest.env" ]] && { readlink -f "$resolved/${base_id}"; return 0; }
      fi
    fi
  fi

  for d in "$(dirname "$patch")" "$AIRGAP_AUTO_TRANSFER_DIR" /var/backups/spark-airgap "$PWD"; do
    [[ -d "$d" ]] || continue
    [[ -f "$d/${base_id}.tar.gz" ]] && { readlink -f "$d/${base_id}.tar.gz"; return 0; }
    [[ -d "$d/${base_id}" && -f "$d/${base_id}/metadata/manifest.env" ]] && { readlink -f "$d/${base_id}"; return 0; }
  done

  fail "Matching base bundle ${base_id}.tar.gz was not found beside the patch or in ${AIRGAP_AUTO_TRANSFER_DIR}."
  return 1
}

airgap_auto_verify_sidecar() {
  local input="$1" sidecar dir name
  [[ -f "$input" ]] || return 0
  sidecar="${input}.sha256"
  [[ -f "$sidecar" ]] || return 0
  dir="$(dirname "$input")"
  name="$(basename "$sidecar")"
  run_visible "Verify $(basename "$input") SHA256 sidecar" bash -c "cd \"$dir\" && sha256sum -c \"$name\""
}

airgap_auto_find_prepared() {
  local base_id="$1" target_release="$2" row
  row="$(find "$AIRGAP_PREPARED_DIR" -mindepth 1 -maxdepth 1 -type d \
    -name "${base_id}-retargeted-ubuntu${target_release}-*" -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr | head -n1)"
  [[ -n "$row" ]] || return 1
  printf '%s\n' "${row#* }"
}

airgap_auto_bootstrap_path() {
  local path
  for path in \
    /usr/local/lib/spark-manager/bootstrap-airgap.sh \
    "${SPARK_ROOT}/deploy/spark-cli/bootstrap-airgap.sh"; do
    [[ -f "$path" ]] || continue
    printf '%s\n' "$path"
    return 0
  done
  return 1
}

airgap_auto_apply_and_bootstrap() {
  title
  new_log "airgap-auto-target-bootstrap"
  local requested_base="${1:-}" requested_patch="${2:-}"
  local patch base base_id target_release prepared bootstrap tmp_root rc

  patch="$(airgap_auto_find_patch "$requested_patch")" || return 1
  base="$(airgap_auto_find_base "$patch" "$requested_base")" || return 1
  base_id="$(airgap_auto_patch_meta "$patch" BASE_BUNDLE_ID)" || return 1
  target_release="$(airgap_auto_patch_meta "$patch" TARGET_UBUNTU_VERSION)" || return 1

  info "Automatically selected target patch: $patch"
  info "Automatically matched base bundle: $base"

  airgap_auto_verify_sidecar "$patch" || return 1
  airgap_auto_verify_sidecar "$base" || return 1

  # Force all temporary extraction into a private workspace that is removed on
  # either success or failure. This prevents multi-GB /tmp leaks on the target.
  tmp_root="${AIRGAP_HOME}/auto-work.$$"
  rm -rf "$tmp_root"
  mkdir -p "$tmp_root"
  set +e
  TMPDIR="$tmp_root" airgap_apply_target_patch "$base" "$patch"
  rc=$?
  set -e
  rm -rf "$tmp_root"
  (( rc == 0 )) || return "$rc"

  prepared="$(airgap_auto_find_prepared "$base_id" "$target_release")" || {
    fail "Prepared Ubuntu ${target_release} bundle was not found after target patch application."
    return 1
  }
  bootstrap="$(airgap_auto_bootstrap_path)" || {
    fail "Offline bootstrap runtime is missing. Run Manager Update once, then retry this action."
    return 1
  }

  info "Prepared bundle: $prepared"
  info "Starting offline bootstrap automatically; no additional path entry is required."
  run_visible "Install local packages, Docker/Node, restore Spark and import Docker images" \
    bash "$bootstrap" "$prepared" || return 1

  ok "Automatic target patch + air-gapped bootstrap completed successfully."
  printf 'Prepared bundle : %s\n' "$prepared"
  printf 'Target          : Ubuntu %s / %s\n' "$target_release" "$(dpkg --print-architecture)"
  printf 'Next            : run spark and use Installation Air-Gapped -> 04 or 05.\n'
}

# The bundle source is authoritative during an offline installation. Previous
# bootstrap/manager runs can legitimately leave generated or temporary files in
# /opt/spark. Back them up before reconciling instead of forcing the operator to
# inspect/reset the repository manually.
airgap_backup_dirty_source() {
  local destination="$1" stamp backup head
  local -a untracked=()
  [[ -d "${destination}/.git" ]] || return 0
  [[ -n "$(git -C "$destination" status --porcelain)" ]] || return 0

  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup="${BACKUP_DIR}/airgap-source-reconcile-${stamp}"
  mkdir -p "$backup"
  chmod 0700 "$backup"
  head="$(git -C "$destination" rev-parse HEAD 2>/dev/null || true)"
  printf 'SOURCE=%s\nHEAD=%s\nCREATED_AT=%s\n' "$destination" "$head" "$stamp" >"${backup}/metadata.txt"
  git -C "$destination" status --porcelain=v1 >"${backup}/status.txt" || true
  git -C "$destination" diff --binary >"${backup}/tracked.patch" || true
  git -C "$destination" diff --cached --binary >"${backup}/staged.patch" || true
  mapfile -d '' -t untracked < <(git -C "$destination" ls-files --others --exclude-standard -z)
  if ((${#untracked[@]} > 0)); then
    printf '%s\0' "${untracked[@]}" | (cd "$destination" && tar -czf "${backup}/untracked.tar.gz" --null -T -)
  fi
  chmod -R go-rwx "$backup"
  info "Dirty Spark source preserved before offline reconciliation: $backup"
}

# Override the generic restore helper for the air-gapped control plane. The
# requested bundle commit is exact and authoritative, so after a safety backup
# we reset/clean the working tree and force the local branch to that commit.
airgap_restore_git_bundle() {
  local bundle="$1" destination="$2" branch="$3" commit="$4" origin_url="$5"
  if [[ -d "${destination}/.git" ]]; then
    airgap_backup_dirty_source "$destination" || return 1
    git -C "$destination" reset --hard >/dev/null || return 1
    git -C "$destination" clean -fd >/dev/null || return 1
    git -C "$destination" fetch "$bundle" "$branch" || return 1
    git -C "$destination" checkout -B "$branch" "$commit" || return 1
  elif [[ -e "$destination" ]]; then
    fail "$destination exists but is not a Git repository."
    return 1
  else
    git clone --branch "$branch" "$bundle" "$destination" || return 1
    git -C "$destination" checkout "$commit" || return 1
    git -C "$destination" branch -f "$branch" "$commit" || return 1
    git -C "$destination" checkout "$branch" || return 1
  fi
  if git -C "$destination" remote get-url origin >/dev/null 2>&1; then
    git -C "$destination" remote set-url origin "$origin_url"
  else
    git -C "$destination" remote add origin "$origin_url"
  fi
  git -C "$destination" update-ref "refs/remotes/origin/${branch}" "$commit"
}

airgap_current_control_plane_is_newer() {
  [[ -f /usr/local/lib/spark-manager/lib/airgap-auto.sh ]] || return 1
  [[ -f /usr/local/lib/spark-manager/bootstrap-airgap.sh ]] || return 1
  [[ -x /usr/local/bin/spark-airgap ]] || return 1
  /usr/local/bin/spark-airgap --version >/dev/null 2>&1
}

# Override step 03 so a newer Manager installed from main is not downgraded to
# the older application commit embedded in a previously transferred bundle.
# Application source still remains pinned exactly to the verified bundle commit.
install_step_3() {
  airgap_is_active || { install_step_3_online; return; }
  title
  new_log "install-03-spark-repo-airgap"
  local root commit
  root="$(airgap_current_root)" || { fail "No active air-gap bundle."; return 1; }
  commit="$(airgap_meta_from "$root" SPARK_COMMIT)"
  run_logged "Restore Spark source from local Git bundle" airgap_restore_git_bundle \
    "${root}/sources/spark.git.bundle" "$SPARK_ROOT" main "$commit" "$REPO_URL" || return 1
  [[ "$(git -C "$SPARK_ROOT" rev-parse HEAD)" == "$commit" ]] || return 1

  if airgap_current_control_plane_is_newer; then
    ok "Preserved current Air-Gap Manager control plane; application source remains pinned to bundle commit ${commit:0:12}."
  else
    run_logged "Install Spark Manager from local source" airgap_install_manager_local || return 1
  fi
  mark_step 3
}
