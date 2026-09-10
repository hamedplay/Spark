# Spark Air-Gapped installation support.
# Sourced only by spark-airgap. Normal online installation remains unchanged.

AIRGAP_FORMAT_VERSION="1"
AIRGAP_HOME="${AIRGAP_HOME:-/opt/spark-airgap}"
AIRGAP_BUNDLES_DIR="${AIRGAP_HOME}/bundles"
AIRGAP_CURRENT_LINK="${AIRGAP_HOME}/current"
AIRGAP_CONF="${CONFIG_DIR}/airgap.conf"
AIRGAP_SHIM_DIR="/run/spark-airgap/bin"
AIRGAP_REAL_DOCKER="${AIRGAP_REAL_DOCKER:-/usr/bin/docker}"
AIRGAP_REAL_NPM="${AIRGAP_REAL_NPM:-/usr/bin/npm}"

# Preserve final online implementations after all standard modules are loaded.
eval "$(declare -f install_step_2 | sed '1s/install_step_2/install_step_2_online/')"
eval "$(declare -f install_step_3 | sed '1s/install_step_3/install_step_3_online/')"
eval "$(declare -f install_step_4 | sed '1s/install_step_4/install_step_4_online/')"
eval "$(declare -f install_step_10 | sed '1s/install_step_10/install_step_10_online/')"
eval "$(declare -f install_step_11 | sed '1s/install_step_11/install_step_11_online/')"
eval "$(declare -f install_step_13 | sed '1s/install_step_13/install_step_13_online/')"
eval "$(declare -f install_step_17 | sed '1s/install_step_17/install_step_17_online/')"
eval "$(declare -f livekit_prepare_nginx_tls | sed '1s/livekit_prepare_nginx_tls/livekit_prepare_nginx_tls_online/')"
eval "$(declare -f livekit_public_tls_probe | sed '1s/livekit_public_tls_probe/livekit_public_tls_probe_online/')"
eval "$(declare -f livekit_turn_tls_probe | sed '1s/livekit_turn_tls_probe/livekit_turn_tls_probe_online/')"

airgap_is_active() {
  [[ "${SPARK_AIRGAP_ACTIVE:-0}" == "1" ]]
}

airgap_current_root() {
  if [[ -n "${AIRGAP_ROOT:-}" && -d "${AIRGAP_ROOT}" ]]; then
    printf '%s\n' "$AIRGAP_ROOT"
    return 0
  fi
  if [[ -L "$AIRGAP_CURRENT_LINK" || -d "$AIRGAP_CURRENT_LINK" ]]; then
    readlink -f "$AIRGAP_CURRENT_LINK"
    return 0
  fi
  return 1
}

airgap_meta_from() {
  local root="$1" key="$2" file="${root}/metadata/manifest.env"
  [[ -f "$file" ]] || return 1
  sed -n "s/^${key}=//p" "$file" | tail -n1
}

airgap_meta() {
  local root
  root="$(airgap_current_root)" || return 1
  airgap_meta_from "$root" "$1"
}

airgap_require_file() {
  local path="$1"
  [[ -f "$path" ]] || { fail "Air-gap artifact missing: $path"; return 1; }
}

airgap_validate_checksum_manifest() {
  local root="$1"
  airgap_require_file "${root}/SHA256SUMS" || return 1
  (cd "$root" && sha256sum -c SHA256SUMS)
}

airgap_validate_bundle_dir() {
  local root="$1" format
  [[ -d "$root" ]] || { fail "Air-gap bundle directory not found: $root"; return 1; }
  airgap_require_file "${root}/metadata/manifest.env" || return 1
  airgap_require_file "${root}/manifest.json" || return 1
  airgap_require_file "${root}/sources/spark.git.bundle" || return 1
  airgap_require_file "${root}/sources/supabase.git.bundle" || return 1
  airgap_require_file "${root}/docker/docker-images.tar.gz" || return 1
  airgap_require_file "${root}/docker/images.txt" || return 1
  airgap_require_file "${root}/docker/image-ids.txt" || return 1
  airgap_require_file "${root}/npm/frontend-node-modules.tar.gz" || return 1
  compgen -G "${root}/npm/npm-*.tgz" >/dev/null || { fail "Offline npm package is missing."; return 1; }
  compgen -G "${root}/apt/*.deb" >/dev/null || { fail "Offline APT packages are missing."; return 1; }
  format="$(airgap_meta_from "$root" FORMAT_VERSION)"
  [[ "$format" == "$AIRGAP_FORMAT_VERSION" ]] || {
    fail "Unsupported air-gap bundle format: ${format:-missing}"
    return 1
  }
  run_logged "Validate air-gap SHA256 manifest" airgap_validate_checksum_manifest "$root"
}

airgap_validate_target_compatibility() {
  local root="$1" expected_os expected_arch actual_arch
  . /etc/os-release
  expected_os="$(airgap_meta_from "$root" UBUNTU_VERSION)"
  expected_arch="$(airgap_meta_from "$root" ARCH)"
  actual_arch="$(dpkg --print-architecture)"
  [[ "${ID:-}" == "ubuntu" ]] || { fail "Air-gap target must be Ubuntu."; return 1; }
  [[ "${VERSION_ID:-}" == "$expected_os" ]] || {
    fail "Bundle is for Ubuntu ${expected_os}; target is ${VERSION_ID:-unknown}."
    return 1
  }
  [[ "$actual_arch" == "$expected_arch" ]] || {
    fail "Bundle is for ${expected_arch}; target is ${actual_arch}."
    return 1
  }
}

airgap_archive_safe_paths() {
  local archive="$1" entry
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    case "$entry" in
      /*|../*|*/../*|*'/..')
        fail "Unsafe path in air-gap archive: $entry"
        return 1
        ;;
    esac
  done < <(tar -tzf "$archive")
  if tar -tvzf "$archive" | awk '$1 ~ /^[lh]/ {found=1} END{exit !found}'; then
    fail "Air-gap archive contains symlink/hardlink entries; import refused."
    return 1
  fi
}

airgap_extract_bundle_archive() {
  local archive="$1" destination="$2" root
  [[ -f "$archive" ]] || { fail "Bundle archive not found: $archive"; return 1; }
  airgap_archive_safe_paths "$archive" || return 1
  mkdir -p "$destination"
  tar -xzf "$archive" -C "$destination" || return 1
  root="$(find "$destination" -mindepth 1 -maxdepth 1 -type d -name 'spark-airgap-*' | head -n1)"
  [[ -n "$root" ]] || { fail "Bundle archive does not contain a Spark air-gap root."; return 1; }
  printf '%s\n' "$root"
}

airgap_verify_images() {
  local root="$1" image expected_id actual_id failed=0
  while read -r image expected_id; do
    [[ -n "$image" && -n "$expected_id" ]] || continue
    actual_id="$("$AIRGAP_REAL_DOCKER" image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)"
    if [[ -z "$actual_id" ]]; then
      [[ -n "${CURRENT_LOG:-}" ]] && echo "Missing Docker image: $image" >>"$CURRENT_LOG"
      failed=1
    elif [[ "$actual_id" != "$expected_id" ]]; then
      [[ -n "${CURRENT_LOG:-}" ]] && echo "Docker image ID mismatch: $image expected=$expected_id actual=$actual_id" >>"$CURRENT_LOG"
      failed=1
    fi
  done <"${root}/docker/image-ids.txt"
  (( failed == 0 ))
}

airgap_import_bundle() {
  title
  new_log "airgap-import"
  local input="${1:-}" staging="" root bundle_id final
  if [[ -z "$input" ]]; then read -r -p "Path to Spark air-gap .tar.gz or extracted bundle directory: " input; fi
  [[ -n "$input" ]] || { fail "Bundle path is required."; return 1; }

  mkdir -p "$AIRGAP_BUNDLES_DIR"
  if [[ -d "$input" ]]; then
    root="$(readlink -f "$input")"
  else
    staging="$(mktemp -d "${AIRGAP_HOME}/import.XXXXXX")"
    root="$(airgap_extract_bundle_archive "$input" "$staging")" || { rm -rf "$staging"; return 1; }
  fi

  airgap_validate_bundle_dir "$root" || return 1
  airgap_validate_target_compatibility "$root" || return 1
  bundle_id="$(airgap_meta_from "$root" BUNDLE_ID)"
  [[ -n "$bundle_id" ]] || { fail "Bundle ID is missing."; return 1; }
  final="${AIRGAP_BUNDLES_DIR}/${bundle_id}"

  if [[ "$(readlink -f "$root")" != "$(readlink -m "$final")" ]]; then
    rm -rf "$final"
    mkdir -p "$final"
    cp -a "$root/." "$final/"
  fi
  [[ -n "$staging" ]] && rm -rf "$staging"

  ln -sfn "$final" "$AIRGAP_CURRENT_LINK"
  mkdir -p "$CONFIG_DIR"
  printf 'AIRGAP_ROOT=%s\n' "$final" >"$AIRGAP_CONF"
  chmod 0600 "$AIRGAP_CONF"

  if [[ -f "${final}/config/manager.conf" && ! -f "$MANAGER_CONF" ]]; then
    cp "${final}/config/manager.conf" "$MANAGER_CONF"
    chmod 0600 "$MANAGER_CONF"
    info "Installation configuration restored from bundle because manager.conf did not exist."
  fi

  [[ -x "$AIRGAP_REAL_DOCKER" ]] || { fail "Docker is not installed yet. Run bootstrap-airgap.sh first."; return 1; }
  run_visible "Load offline Docker images" bash -c "gzip -dc '$final/docker/docker-images.tar.gz' | '$AIRGAP_REAL_DOCKER' load" || return 1
  run_logged "Verify every bundled Docker image locally" airgap_verify_images "$final" || return 1
  ok "Air-gap bundle imported and activated: $bundle_id"
}

airgap_install_local_debs() {
  local root="$1" apt_guard rc=0
  local -a debs=()
  mapfile -t debs < <(find "${root}/apt" -maxdepth 1 -type f -name '*.deb' -print | sort)
  ((${#debs[@]} > 0)) || { fail "No .deb packages found in bundle."; return 1; }

  apt_guard="$(mktemp -d /run/spark-airgap-apt.XXXXXX)"
  install -d -m 0755 "${apt_guard}/sources.list.d"
  : >"${apt_guard}/sources.list"

  DEBIAN_FRONTEND=noninteractive apt-get \
    -o "Dir::Etc::sourcelist=${apt_guard}/sources.list" \
    -o "Dir::Etc::sourceparts=${apt_guard}/sources.list.d" \
    -o APT::Get::List-Cleanup=0 \
    install -y --allow-downgrades "${debs[@]}" || rc=$?

  rm -rf "$apt_guard"
  return "$rc"
}

airgap_install_manager_local() {
  local source_dir="${SPARK_ROOT}/deploy/spark-cli" stage target="/usr/local/lib/spark-manager"
  local migrate_target="/usr/local/lib/spark-migrate" file
  airgap_require_file "${source_dir}/spark" || return 1
  airgap_require_file "${source_dir}/spark-ui.py" || return 1
  airgap_require_file "${source_dir}/spark-ui-core.py" || return 1
  airgap_require_file "${source_dir}/spark-airgap" || return 1
  airgap_require_file "${source_dir}/spark-migrate" || return 1
  require_dir "${SPARK_ROOT}/deploy/livekit" || return 1

  bash -n "${source_dir}/spark" || return 1
  bash -n "${source_dir}/spark-airgap" || return 1
  for file in "${source_dir}"/lib/*.sh; do bash -n "$file" || return 1; done
  python3 - "${source_dir}/spark-ui.py" "${source_dir}/spark-ui-core.py" <<'PY'
from pathlib import Path
import sys
for item in sys.argv[1:]: compile(Path(item).read_text(encoding='utf-8'), item, 'exec')
PY
  python3 "${source_dir}/spark-ui.py" --self-test >/dev/null || return 1

  # The installed Manager is the Air-Gap control plane. Do not downgrade it to
  # the application snapshot embedded in an older offline bundle during step 03.
  if [[ -x /usr/local/bin/spark && -x /usr/local/bin/spark-airgap && -x /usr/local/bin/spark-migrate ]]; then
    local installed_manager_version installed_airgap_version
    installed_manager_version="$(/usr/local/bin/spark --version 2>/dev/null || true)"
    installed_airgap_version="$(/usr/local/bin/spark-airgap --version 2>/dev/null || true)"
    if [[ "$installed_manager_version" == "Spark Server Manager ${SPARK_MANAGER_VERSION}" \
          && "$installed_airgap_version" == "Spark Air-Gapped Installer ${SPARK_MANAGER_VERSION}" ]]; then
      info "Preserving current Spark Manager control plane ${SPARK_MANAGER_VERSION}; bundled Spark application source remains pinned to its verified snapshot."
      return 0
    fi
  fi

  stage="$(mktemp -d /usr/local/lib/spark-manager.airgap.XXXXXX)"
  chmod 0755 "$stage"
  install -d -m 0755 "$stage/lib" "$stage/livekit"
  install -m 0755 "${source_dir}/spark" "$stage/spark"
  install -m 0755 "${source_dir}/spark-airgap" "$stage/spark-airgap"
  install -m 0644 "${source_dir}/spark-ui.py" "$stage/spark-ui.py"
  install -m 0644 "${source_dir}/spark-ui-core.py" "$stage/spark-ui-core.py"
  for file in "${source_dir}"/lib/*.sh; do install -m 0644 "$file" "$stage/lib/$(basename "$file")"; done
  cp -a "${SPARK_ROOT}/deploy/livekit/." "$stage/livekit/"
  rm -rf "$target"
  mv "$stage" "$target"
  chmod 0755 "$target"
  ln -sfn "$target/spark" /usr/local/bin/spark
  ln -sfn "$target/spark-airgap" /usr/local/bin/spark-airgap

  rm -rf "$migrate_target"
  install -d -m 0755 "$migrate_target"
  install -m 0755 "${source_dir}/spark-migrate" "$migrate_target/spark-migrate"
  ln -sfn "$migrate_target/spark-migrate" /usr/local/bin/spark-migrate
}

airgap_restore_git_bundle() {
  local bundle="$1" destination="$2" branch="$3" commit="$4" origin_url="$5"
  if [[ -d "${destination}/.git" ]]; then
    [[ -z "$(git -C "$destination" status --porcelain)" ]] || { fail "$destination has uncommitted changes."; return 1; }
    git -C "$destination" fetch "$bundle" "$branch" || return 1
    git -C "$destination" checkout "$branch" || return 1
    git -C "$destination" merge --ff-only "$commit" || return 1
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

airgap_prepare_runtime_shims() {
  local root="$1"
  mkdir -p "$AIRGAP_SHIM_DIR"
  cat >"${AIRGAP_SHIM_DIR}/docker" <<'SHIM_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
real="${AIRGAP_REAL_DOCKER:-/usr/bin/docker}"
if [[ "${SPARK_AIRGAP_ACTIVE:-0}" == "1" && "${1:-}" == "compose" ]]; then
  for arg in "$@"; do
    case "$arg" in
      pull)
        printf '[air-gap] docker compose pull skipped; bundled images are authoritative.\n'
        exit 0
        ;;
      build)
        printf '[air-gap] docker compose build skipped; bundled Avatar Worker image is authoritative.\n'
        exit 0
        ;;
    esac
  done
fi
exec "$real" "$@"
SHIM_DOCKER
  chmod 0755 "${AIRGAP_SHIM_DIR}/docker"

  cat >"${AIRGAP_SHIM_DIR}/npm" <<'SHIM_NPM'
#!/usr/bin/env bash
set -Eeuo pipefail
real="${AIRGAP_REAL_NPM:-/usr/bin/npm}"
if [[ "${SPARK_AIRGAP_ACTIVE:-0}" == "1" && "${1:-}" == "ci" ]]; then
  root="${AIRGAP_ROOT:?AIRGAP_ROOT is required}"
  archive="${root}/npm/frontend-node-modules.tar.gz"
  [[ -f "$archive" ]] || { echo "Offline node_modules archive missing: $archive" >&2; exit 1; }
  rm -rf node_modules
  tar -xzf "$archive" -C .
  printf '[air-gap] restored frontend node_modules from verified bundle.\n'
  exit 0
fi
exec "$real" "$@"
SHIM_NPM
  chmod 0755 "${AIRGAP_SHIM_DIR}/npm"
  export PATH="${AIRGAP_SHIM_DIR}:${PATH}"
}

airgap_prepare_avatar_compose() {
  local root="$1" image compose_file="${SUPABASE_ROOT}/docker-compose.yml"
  image="$(airgap_meta_from "$root" AVATAR_IMAGE)"
  [[ -n "$image" ]] || { fail "AVATAR_IMAGE missing from air-gap manifest."; return 1; }
  COMPOSE_FILE="$compose_file" AVATAR_IMAGE="$image" python3 - <<'PY'
import os, yaml
from pathlib import Path
p=Path(os.environ['COMPOSE_FILE'])
d=yaml.safe_load(p.read_text(encoding='utf-8')) or {}
s=(d.get('services') or {}).get('avatar-worker')
if not isinstance(s, dict): raise SystemExit('avatar-worker service is missing after Compose hardening')
s.pop('build', None)
s['image']=os.environ['AVATAR_IMAGE']
p.write_text(yaml.safe_dump(d, sort_keys=False, default_flow_style=False), encoding='utf-8')
PY
}


# Builder-only and offline runtime overrides are kept separate for auditability.
source "${SCRIPT_DIR}/lib/airgap-build.sh"
source "${SCRIPT_DIR}/lib/airgap-runtime.sh"
