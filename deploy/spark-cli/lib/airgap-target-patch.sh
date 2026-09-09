# Air-gap Ubuntu target patch support.
# Reuses the large Docker/source/certificate payload from an existing bundle and
# replaces only target-dependent APT/npm artifacts.

AIRGAP_TARGET_PATCH_FORMAT_VERSION="1"
AIRGAP_PREPARED_DIR="${AIRGAP_HOME}/prepared"

airgap_target_patch_meta_from() {
  local root="$1" key="$2" file="${root}/metadata/patch.env"
  [[ -f "$file" ]] || return 1
  sed -n "s/^${key}=//p" "$file" | tail -n1
}

airgap_target_patch_validate_checksums() {
  local root="$1"
  [[ -f "${root}/SHA256SUMS" ]] || { fail "Target patch SHA256SUMS is missing."; return 1; }
  (cd "$root" && sha256sum -c SHA256SUMS)
}

airgap_target_patch_validate_dir() {
  local root="$1" format target arch
  [[ -d "$root" ]] || { fail "Target patch directory not found: $root"; return 1; }
  [[ -f "${root}/metadata/patch.env" ]] || { fail "Target patch metadata is missing."; return 1; }
  [[ -f "${root}/manifest.json" ]] || { fail "Target patch manifest is missing."; return 1; }
  compgen -G "${root}/apt/*.deb" >/dev/null || { fail "Target patch APT payload is missing."; return 1; }
  [[ -f "${root}/npm/frontend-node-modules.tar.gz" ]] || { fail "Target patch frontend node_modules payload is missing."; return 1; }
  compgen -G "${root}/npm/npm-*.tgz" >/dev/null || { fail "Target patch npm package is missing."; return 1; }
  format="$(airgap_target_patch_meta_from "$root" PATCH_FORMAT_VERSION)"
  [[ "$format" == "$AIRGAP_TARGET_PATCH_FORMAT_VERSION" ]] || {
    fail "Unsupported target patch format: ${format:-missing}"
    return 1
  }
  target="$(airgap_target_patch_meta_from "$root" TARGET_UBUNTU_VERSION)"
  case "$target" in 24.04|26.04) ;; *) fail "Invalid target Ubuntu release in patch: ${target:-missing}"; return 1 ;; esac
  arch="$(airgap_target_patch_meta_from "$root" ARCH)"
  [[ "$arch" == "amd64" ]] || { fail "Unsupported target patch architecture: ${arch:-missing}"; return 1; }
  airgap_target_patch_validate_checksums "$root"
}

airgap_target_patch_extract() {
  local archive="$1" destination="$2" root entry
  [[ -f "$archive" ]] || { fail "Target patch archive not found: $archive"; return 1; }
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    case "$entry" in
      /*|../*|*/../*|*'/..') fail "Unsafe path in target patch archive: $entry"; return 1 ;;
    esac
  done < <(tar -tzf "$archive")
  if tar -tvzf "$archive" | awk '$1 ~ /^[lh]/ {found=1} END{exit !found}'; then
    fail "Target patch archive contains symlink/hardlink entries; refused."
    return 1
  fi
  mkdir -p "$destination"
  tar -xzf "$archive" -C "$destination" || return 1
  root="$(find "$destination" -mindepth 1 -maxdepth 1 -type d -name 'spark-airgap-target-patch-*' | head -n1)"
  [[ -n "$root" ]] || { fail "Target patch root directory is missing."; return 1; }
  printf '%s\n' "$root"
}

airgap_target_patch_open_base() {
  local input="$1" destination="$2"
  if [[ -d "$input" ]]; then
    printf '%s\n' "$(readlink -f "$input")"
  else
    airgap_extract_bundle_archive "$input" "$destination"
  fi
}

airgap_target_patch_open_patch() {
  local input="$1" destination="$2"
  if [[ -d "$input" ]]; then
    printf '%s\n' "$(readlink -f "$input")"
  else
    airgap_target_patch_extract "$input" "$destination"
  fi
}

airgap_build_target_patch() {
  title
  new_log "airgap-build-target-patch"
  local base_input="${1:-}" target_release="${2:-}" output_root="${3:-}"
  local work base_root base_stage source patch patch_id base_id base_commit created_at
  local base_target base_arch saved_spark_root

  for cmd in docker git tar gzip sha256sum python3; do
    command -v "$cmd" >/dev/null 2>&1 || { fail "Target patch builder requires: $cmd"; return 1; }
  done
  docker info >/dev/null 2>&1 || { fail "Docker daemon is required on the connected target-patch builder host."; return 1; }

  [[ -n "$base_input" ]] || read -r -p "Path to the existing large Spark air-gap bundle (.tar.gz or directory): " base_input
  [[ -n "$base_input" ]] || { fail "Base bundle path is required."; return 1; }
  [[ -n "$target_release" ]] || airgap_prompt_default target_release "New target Ubuntu release" "26.04"
  case "$target_release" in 24.04|26.04) ;; *) fail "Supported targets: Ubuntu 24.04 or 26.04."; return 1 ;; esac
  [[ -n "$output_root" ]] || airgap_prompt_default output_root "Target patch output directory" "/var/backups/spark-airgap"
  mkdir -p "$output_root"

  work="$(mktemp -d)"
  base_stage="${work}/base"
  mkdir -p "$base_stage"
  base_root="$(airgap_target_patch_open_base "$base_input" "$base_stage")" || return 1
  airgap_validate_bundle_dir "$base_root" || return 1

  base_id="$(airgap_meta_from "$base_root" BUNDLE_ID)"
  base_commit="$(airgap_meta_from "$base_root" SPARK_COMMIT)"
  base_target="$(airgap_meta_from "$base_root" UBUNTU_VERSION)"
  base_arch="$(airgap_meta_from "$base_root" ARCH)"
  [[ "$base_arch" == "amd64" ]] || { fail "Only amd64 base bundles can be target-patched."; return 1; }
  [[ "$base_commit" =~ ^[0-9a-f]{40}$ ]] || { fail "Base bundle Spark commit is invalid."; return 1; }
  [[ "$base_target" != "$target_release" ]] || { fail "Base bundle already targets Ubuntu ${target_release}; no target patch is needed."; return 1; }

  source="${work}/spark-source"
  git clone --branch main "${base_root}/sources/spark.git.bundle" "$source" >/dev/null 2>&1 || return 1
  git -C "$source" checkout "$base_commit" >/dev/null 2>&1 || return 1

  created_at="$(date -u +%Y%m%dT%H%M%SZ)"
  patch_id="spark-airgap-target-patch-${base_commit:0:12}-ubuntu${target_release}-amd64-${created_at}"
  patch="${work}/${patch_id}"
  mkdir -p "$patch"/{metadata,apt,npm}

  run_visible "Build Ubuntu ${target_release} APT replacement payload" \
    airgap_build_apt_payload "${patch}/apt" "$target_release" || return 1

  saved_spark_root="$SPARK_ROOT"
  SPARK_ROOT="$source"
  run_visible "Build Ubuntu ${target_release} frontend/npm replacement payload" \
    airgap_build_npm_payload "${patch}/npm" "$target_release" || return 1
  SPARK_ROOT="$saved_spark_root"

  cat >"${patch}/metadata/patch.env" <<EOF_META
PATCH_FORMAT_VERSION=${AIRGAP_TARGET_PATCH_FORMAT_VERSION}
PATCH_ID=${patch_id}
CREATED_AT=${created_at}
BASE_BUNDLE_ID=${base_id}
BASE_SPARK_COMMIT=${base_commit}
SOURCE_UBUNTU_VERSION=${base_target}
TARGET_UBUNTU_VERSION=${target_release}
ARCH=amd64
EOF_META
  chmod 0600 "${patch}/metadata/patch.env"

  PATCH_ROOT="$patch" python3 - <<'PY'
import json, os
from pathlib import Path
root=Path(os.environ['PATCH_ROOT'])
values={}
for line in (root/'metadata/patch.env').read_text().splitlines():
    if '=' in line:
        k,v=line.split('=',1); values[k]=v
(root/'manifest.json').write_text(json.dumps(values, indent=2, sort_keys=True)+"\n", encoding='utf-8')
PY
  (cd "$patch" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS) || return 1
  airgap_target_patch_validate_dir "$patch" || return 1
  tar -C "$work" -czf "${output_root}/${patch_id}.tar.gz" "$patch_id" || return 1
  (cd "$output_root" && sha256sum "${patch_id}.tar.gz" >"${patch_id}.tar.gz.sha256")
  rm -rf "$work"

  ok "Ubuntu target patch created: ${output_root}/${patch_id}.tar.gz"
  printf 'Base bundle : %s\n' "$base_id"
  printf 'Spark commit: %s\n' "$base_commit"
  printf 'Target      : Ubuntu %s / amd64\n' "$target_release"
  printf 'Note        : Docker images, Git sources and certificates are NOT duplicated in this patch.\n'
}

airgap_apply_target_patch() {
  title
  new_log "airgap-apply-target-patch"
  local base_input="${1:-}" patch_input="${2:-}" work base_stage patch_stage base_root patch_root
  local base_id base_commit patch_base_id patch_commit target_release target_arch actual_arch
  local prepared_work prepared_root new_id patched_at

  [[ -n "$base_input" ]] || read -r -p "Path to existing large Spark bundle (.tar.gz or directory): " base_input
  [[ -n "$patch_input" ]] || read -r -p "Path to Ubuntu target patch (.tar.gz or directory): " patch_input
  [[ -n "$base_input" && -n "$patch_input" ]] || { fail "Both base bundle and target patch paths are required."; return 1; }

  work="$(mktemp -d)"
  base_stage="${work}/base"; patch_stage="${work}/patch"
  mkdir -p "$base_stage" "$patch_stage" "$AIRGAP_PREPARED_DIR"

  base_root="$(airgap_target_patch_open_base "$base_input" "$base_stage")" || return 1
  patch_root="$(airgap_target_patch_open_patch "$patch_input" "$patch_stage")" || return 1
  airgap_validate_bundle_dir "$base_root" || return 1
  airgap_target_patch_validate_dir "$patch_root" || return 1

  base_id="$(airgap_meta_from "$base_root" BUNDLE_ID)"
  base_commit="$(airgap_meta_from "$base_root" SPARK_COMMIT)"
  patch_base_id="$(airgap_target_patch_meta_from "$patch_root" BASE_BUNDLE_ID)"
  patch_commit="$(airgap_target_patch_meta_from "$patch_root" BASE_SPARK_COMMIT)"
  target_release="$(airgap_target_patch_meta_from "$patch_root" TARGET_UBUNTU_VERSION)"
  target_arch="$(airgap_target_patch_meta_from "$patch_root" ARCH)"

  [[ "$base_id" == "$patch_base_id" ]] || { fail "Target patch belongs to bundle ${patch_base_id}, not ${base_id}."; return 1; }
  [[ "$base_commit" == "$patch_commit" ]] || { fail "Target patch Spark commit does not match the base bundle."; return 1; }

  . /etc/os-release
  actual_arch="$(dpkg --print-architecture)"
  [[ "${ID:-}" == ubuntu ]] || { fail "Target patch can only be applied for an Ubuntu target."; return 1; }
  [[ "${VERSION_ID:-}" == "$target_release" ]] || {
    fail "Patch target is Ubuntu ${target_release}; this server is ${VERSION_ID:-unknown}."
    return 1
  }
  [[ "$actual_arch" == "$target_arch" ]] || { fail "Patch architecture is ${target_arch}; this server is ${actual_arch}."; return 1; }

  patched_at="$(date -u +%Y%m%dT%H%M%SZ)"
  new_id="${base_id}-retargeted-ubuntu${target_release}-${patched_at}"
  prepared_work="${AIRGAP_PREPARED_DIR}/.${new_id}.work"
  rm -rf "$prepared_work" "${AIRGAP_PREPARED_DIR}/${new_id}"
  mkdir -p "$prepared_work"

  if [[ -f "$base_input" ]]; then
    # The 5GB archive was already extracted for validation; move that extraction
    # into the prepared area instead of copying or rebuilding the Docker payload.
    mv "$base_root" "$prepared_work/bundle"
  else
    mkdir -p "$prepared_work/bundle"
    cp -a --reflink=auto "$base_root/." "$prepared_work/bundle/" 2>/dev/null || cp -a "$base_root/." "$prepared_work/bundle/"
  fi
  prepared_root="$prepared_work/bundle"

  rm -rf "${prepared_root}/apt" "${prepared_root}/npm"
  mkdir -p "${prepared_root}/apt" "${prepared_root}/npm"
  cp -a "${patch_root}/apt/." "${prepared_root}/apt/"
  cp -a "${patch_root}/npm/." "${prepared_root}/npm/"

  sed -i "s/^BUNDLE_ID=.*/BUNDLE_ID=${new_id}/" "${prepared_root}/metadata/manifest.env"
  sed -i "s/^UBUNTU_VERSION=.*/UBUNTU_VERSION=${target_release}/" "${prepared_root}/metadata/manifest.env"
  printf 'ORIGINAL_BUNDLE_ID=%s\nTARGET_PATCH_ID=%s\nRETARGETED_AT=%s\n' \
    "$base_id" "$(airgap_target_patch_meta_from "$patch_root" PATCH_ID)" "$patched_at" \
    >>"${prepared_root}/metadata/manifest.env"

  BUNDLE_ROOT="$prepared_root" python3 - <<'PY'
import json, os
from pathlib import Path
root=Path(os.environ['BUNDLE_ROOT'])
values={}
for line in (root/'metadata/manifest.env').read_text().splitlines():
    if '=' in line:
        k,v=line.split('=',1); values[k]=v
(root/'manifest.json').write_text(json.dumps(values, indent=2, sort_keys=True)+"\n", encoding='utf-8')
PY
  (cd "$prepared_root" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS) || return 1
  airgap_validate_bundle_dir "$prepared_root" || return 1
  airgap_validate_target_compatibility "$prepared_root" || return 1

  mv "$prepared_root" "$AIRGAP_PREPARED_DIR/$new_id"
  rm -rf "$prepared_work" "$work"
  prepared_root="$AIRGAP_PREPARED_DIR/$new_id"

  ok "Base bundle retargeted without retransferring or rebuilding the Docker image payload."
  printf 'Prepared bundle: %s\n' "$prepared_root"
  printf 'New target     : Ubuntu %s / %s\n' "$target_release" "$target_arch"
  printf '\nNext command:\n  sudo bash /opt/spark/deploy/spark-cli/bootstrap-airgap.sh %q\n' "$prepared_root"
}
