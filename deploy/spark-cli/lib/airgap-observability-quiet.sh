# Air-Gap optional runtime extensions.
# Keep observability readiness-noise behavior, then load the format-v2 Edge
# Runtime source/cache implementation and its final mount/cache hardening.

source "${SCRIPT_DIR}/lib/airgap-observability-quiet-base.sh"
source "${SCRIPT_DIR}/lib/airgap-edge-functions.sh"
source "${SCRIPT_DIR}/lib/airgap-edge-functions-runtime-fix.sh"
source "${SCRIPT_DIR}/lib/airgap-edge-final.sh"

# Final builder override: never build an Air-Gap bundle from moving Supabase
# master/main. The connected builder must already have an exact stable
# self-hosted/vX.Y.Z source checkout. If a live runtime exists, its provenance
# must also match that source. The bundle then clones the exact tag, verifies the
# commit, and records both identities in metadata before any Docker/DENO_DIR
# payload is assembled.
airgap_build_bundle() (
  title
  new_log "airgap-build"
  local target_release output_root cert_source work bundle bundle_id spark_commit spark_short
  local supabase_source supabase_commit supabase_ref supabase_expected_commit
  local supabase_bundle_branch="spark-pinned-supabase"
  local avatar_image created_at config_pack=0 cert_pack=0

  for cmd in git docker tar gzip sha256sum openssl python3; do
    command -v "$cmd" >/dev/null 2>&1 || { fail "Bundle builder requires: $cmd"; return 1; }
  done
  [[ -d "${SPARK_ROOT}/.git" ]] || { fail "Spark source repository is required at ${SPARK_ROOT}."; return 1; }
  [[ "$(git -C "$SPARK_ROOT" branch --show-current)" == "main" ]] || { fail "Spark bundle must be built from branch main."; return 1; }
  [[ -z "$(git -C "$SPARK_ROOT" status --porcelain)" ]] || { fail "Spark repository has uncommitted changes; bundle generation refused."; return 1; }
  docker info >/dev/null 2>&1 || { fail "Docker daemon is required on the connected bundle-builder host."; return 1; }

  [[ -d "${SUPABASE_SOURCE}/.git" ]] || {
    fail "Pinned Supabase source repository is required at ${SUPABASE_SOURCE}. Run/repair Installation step 4 first."
    return 1
  }
  [[ "$(git -C "$SUPABASE_SOURCE" remote get-url origin 2>/dev/null || true)" == "https://github.com/supabase/supabase.git" ]] || {
    fail "Supabase source origin is not the official repository."
    return 1
  }
  [[ -z "$(git -C "$SUPABASE_SOURCE" status --porcelain)" ]] || {
    fail "Pinned Supabase source has uncommitted changes; bundle generation refused."
    return 1
  }

  supabase_expected_commit="$(git -C "$SUPABASE_SOURCE" rev-parse HEAD 2>/dev/null || true)"
  supabase_ref="$(git -C "$SUPABASE_SOURCE" describe --tags --exact-match "$supabase_expected_commit" 2>/dev/null || true)"
  [[ "$supabase_expected_commit" =~ ^[0-9a-f]{40}$ ]] || {
    fail "Unable to resolve the pinned Supabase source commit."
    return 1
  }
  [[ "$supabase_ref" =~ ^self-hosted/v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    fail "Supabase source must be pinned to an exact stable self-hosted/vX.Y.Z tag; got ${supabase_ref:-none}."
    return 1
  }
  [[ "$(git -C "$SUPABASE_SOURCE" rev-list -n1 "$supabase_ref" 2>/dev/null || true)" == "$supabase_expected_commit" ]] || {
    fail "Supabase stable tag does not resolve to the checked-out source commit."
    return 1
  }

  if [[ -f "${SUPABASE_ROOT}/.env" ]]; then
    test_supabase_source || {
      fail "Live Supabase runtime provenance does not match the pinned source; bundle generation refused."
      return 1
    }
  fi

  . /etc/os-release
  info "Builder Ubuntu ${VERSION_ID:-unknown}; packages will be resolved for the destination, not copied from this host."
  airgap_prompt_default target_release "Destination Ubuntu release (bank server)" "26.04"
  target_release="$(airgap_normalize_ubuntu_release "$target_release")" || return 1
  info "Bundle target: Ubuntu ${target_release}/amd64; Nginx comes from that release repository."
  airgap_prompt_default output_root "Bundle output directory" "/var/backups/spark-airgap"
  # IP-only bundles never export staging-host configuration or private TLS keys.

  mkdir -p "$output_root"
  work="$(mktemp -d)"
  trap '[[ -z "${work:-}" ]] || rm -rf -- "$work"' EXIT

  spark_commit="$(git -C "$SPARK_ROOT" rev-parse HEAD)"
  spark_short="${spark_commit:0:12}"
  created_at="$(date -u +%Y%m%dT%H%M%SZ)"
  bundle_id="spark-airgap-${spark_short}-ubuntu${target_release}-amd64-${created_at}"
  bundle="${work}/${bundle_id}"
  mkdir -p "$bundle"/{metadata,sources,apt,docker,npm,certificates,config}

  info "Creating Spark source bundle at ${spark_short}."
  git -C "$SPARK_ROOT" bundle create "${bundle}/sources/spark.git.bundle" main || return 1

  supabase_source="${work}/supabase-source"
  run_visible "Clone pinned Supabase ${supabase_ref} for offline snapshot" \
    git clone --branch "$supabase_ref" --single-branch https://github.com/supabase/supabase.git "$supabase_source" || return 1
  supabase_commit="$(git -C "$supabase_source" rev-parse HEAD)"
  [[ "$supabase_commit" == "$supabase_expected_commit" ]] || {
    fail "Upstream ${supabase_ref} resolved to ${supabase_commit}; expected tested commit ${supabase_expected_commit}."
    return 1
  }
  git -C "$supabase_source" show-ref --verify --quiet "refs/tags/${supabase_ref}" || {
    fail "Pinned Supabase tag ref is missing from the builder checkout."
    return 1
  }
  git -C "$supabase_source" branch -f "$supabase_bundle_branch" "$supabase_commit" || return 1
  git -C "$supabase_source" bundle create "${bundle}/sources/supabase.git.bundle" \
    "refs/heads/${supabase_bundle_branch}" "refs/tags/${supabase_ref}" || return 1

  run_visible "Build Ubuntu/Docker/Node offline APT payload" airgap_build_apt_payload "${bundle}/apt" "$target_release" || return 1

  run_visible "Build target-matched frontend/npm offline payload" \
    airgap_build_npm_payload "${bundle}/npm" "$target_release" || return 1
  run_visible "Prove APT/npm installation and frontend build with networking disabled" \
    airgap_prove_offline_payloads "$bundle" "$target_release" || return 1

  avatar_image="spark/avatar-worker-airgap:${spark_short}"
  run_visible "Build pinned Avatar Worker image" docker build --platform linux/amd64 --pull --no-cache -t "$avatar_image" "${SPARK_ROOT}/worker" || return 1
  airgap_collect_compose_images "$supabase_source" "${bundle}/docker/images.txt" || return 1
  printf '%s\n' "$avatar_image" >>"${bundle}/docker/images.txt"
  sort -u -o "${bundle}/docker/images.txt" "${bundle}/docker/images.txt"

  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    [[ "$image" == "$avatar_image" ]] && continue
    run_visible "Resolve and pull exact linux/amd64 image ${image}" \
      airgap_prepare_bundle_image "$image" "$bundle" || return 1
  done <"${bundle}/docker/images.txt"

  info "Validating and saving the linux/amd64 Docker image set. This can take several minutes."
  airgap_write_image_ids "$bundle" || return 1
  _airgap_edge_validate_payload "$bundle" || return 1
  run_visible "Validate and export linux/amd64 Docker images" \
    airgap_export_linux_amd64_images "${bundle}/docker/images.txt" "${bundle}/docker/docker-images.tar.gz" || return 1
  local AIRGAP_REAL_DOCKER=docker
  airgap_verify_images "$bundle" || { fail "Docker image identities changed during export."; return 1; }


  cat >"${bundle}/metadata/manifest.env" <<EOF_META
FORMAT_VERSION=${AIRGAP_FORMAT_VERSION}
OFFLINE_PROOF_REQUIRED=1
BUNDLE_ID=${bundle_id}
CREATED_AT=${created_at}
UBUNTU_VERSION=${target_release}
ARCH=amd64
SPARK_COMMIT=${spark_commit}
SUPABASE_BRANCH=${supabase_bundle_branch}
SUPABASE_REF=${supabase_ref}
SUPABASE_COMMIT=${supabase_commit}
AVATAR_IMAGE=${avatar_image}
CONFIG_PACK=${config_pack}
CERTIFICATE_PACK=${cert_pack}
EOF_META
  chmod 0600 "${bundle}/metadata/manifest.env"

  BUNDLE_ROOT="$bundle" python3 - <<'PY'
import json, os
from pathlib import Path
root=Path(os.environ['BUNDLE_ROOT'])
values={}
for line in (root/'metadata/manifest.env').read_text().splitlines():
    if '=' in line:
        k,v=line.split('=',1); values[k]=v
(root/'manifest.json').write_text(json.dumps(values, indent=2, sort_keys=True)+"\n", encoding='utf-8')
PY

  (cd "$bundle" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS) || return 1
  airgap_validate_bundle_dir "$bundle" || return 1
  airgap_publish_bundle "$bundle" "$output_root" || return 1
  rm -rf "$work"
  work=""

  ok "Air-gap bundle created: ${output_root}/${bundle_id}.tar.gz"
  printf 'Spark commit        : %s\n' "$spark_commit"
  printf 'Supabase ref        : %s\n' "$supabase_ref"
  printf 'Supabase commit     : %s\n' "$supabase_commit"
  printf 'Target              : Ubuntu %s / amd64\n' "$target_release"
  printf 'TLS certificate pack: %s\n' "$([[ "$cert_pack" == 1 ]] && echo INCLUDED || echo MISSING)"
  if [[ "$cert_pack" != 1 ]]; then
    info "Internal-IP offline installation does not require a local TLS certificate pack."
  fi
)
