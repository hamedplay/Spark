# Air-gap bundle builder. Sourced by lib/airgap.sh.

airgap_prompt_default() {
  local __var="$1" label="$2" default_value="$3" value
  read -r -p "${label} [${default_value}]: " value
  printf -v "$__var" '%s' "${value:-$default_value}"
}

airgap_build_apt_payload() {
  local output="$1" target_release="$2" count container rc
  mkdir -p "$output"
  find "$output" -maxdepth 1 -type f -name '*.deb' -delete
  rm -f "${output}/requested-packages.txt"

  # Do not rely on an APT cache bind-mount. Ubuntu/Docker APT cleanup hooks and
  # _apt sandbox permissions can make a successful download disappear from the
  # host mount. Build the complete payload inside a retained container, then
  # copy the verified payload to the host with `docker cp`.
  container="spark-airgap-apt-${target_release//./-}-$$-${RANDOM}"
  docker rm -f "$container" >/dev/null 2>&1 || true
  trap 'docker rm -f "$container" >/dev/null 2>&1 || true' RETURN

  set +e
  # -i is required because the builder script is supplied to `bash -s` on stdin.
  # Without it Docker detaches container stdin and bash exits successfully
  # without executing the heredoc, leaving /payload absent.
  docker run -i --name "$container" --platform linux/amd64 \
    -e TARGET_RELEASE="$target_release" \
    "ubuntu:${target_release}" bash -s <<'BUNDLE_APT'
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive

# Keep every .deb downloaded while bootstrapping repository tooling as well as
# the final Spark package set. This preserves transitive dependencies needed on
# a bare target host.
rm -f /etc/apt/apt.conf.d/docker-clean
apt-get update
apt-get install -y ca-certificates curl gnupg

. /etc/os-release
codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
[[ -n "$codename" ]]
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
cat >/etc/apt/sources.list.d/docker.list <<EOF_DOCKER
deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable
EOF_DOCKER
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
chmod a+r /etc/apt/keyrings/nodesource.gpg
cat >/etc/apt/sources.list.d/nodesource.list <<'EOF_NODE'
deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main
EOF_NODE
apt-get update
packages=(
  ca-certificates curl git gnupg jq openssl ufw rsync python3 python3-yaml
  nginx certbot coturn docker-ce docker-ce-cli containerd.io
  docker-buildx-plugin docker-compose-plugin nodejs
)

# --reinstall guarantees the requested packages themselves are present in the
# cache; packages downloaded during the bootstrap install above remain there
# because docker-clean was disabled before the first install.
apt-get install -y --download-only --reinstall "${packages[@]}"
mkdir -p /payload
cp -a /var/cache/apt/archives/*.deb /payload/
printf '%s\n' "${packages[@]}" >/payload/requested-packages.txt
count="$(find /payload -maxdepth 1 -type f -name '*.deb' | wc -l | tr -d '[:space:]')"
[[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]]
printf 'Prepared %s offline .deb files inside container.\n' "$count"
BUNDLE_APT
  rc=$?
  set -e
  if (( rc != 0 )); then
    fail "Offline APT payload container build failed (exit=${rc})."
    return "$rc"
  fi

  if ! docker cp "${container}:/payload/." "$output/"; then
    fail "Unable to copy offline APT payload from builder container."
    return 1
  fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  trap - RETURN

  count="$(find "$output" -maxdepth 1 -type f -name '*.deb' | wc -l | tr -d '[:space:]')"
  [[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]] || {
    fail "Offline APT payload build returned success but produced no .deb files in ${output}."
    return 1
  }
  [[ -s "${output}/requested-packages.txt" ]] || {
    fail "Offline APT requested package manifest is missing from ${output}."
    return 1
  }
  info "Offline APT payload contains ${count} .deb files."
}

airgap_build_npm_payload() {
  local output="$1" target_release="$2"
  mkdir -p "$output"
  rm -f "${output}/frontend-node-modules.tar.gz" "${output}"/npm-*.tgz
  # The npm builder also receives its script over stdin, so keep stdin attached.
  docker run --rm -i --platform linux/amd64 \
    -e TARGET_RELEASE="$target_release" \
    -v "${SPARK_ROOT}:/src:ro" \
    -v "${output}:/out" \
    "ubuntu:${target_release}" bash -s <<'BUNDLE_NPM'
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg tar gzip
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
chmod a+r /etc/apt/keyrings/nodesource.gpg
cat >/etc/apt/sources.list.d/nodesource.list <<'EOF_NODE'
deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main
EOF_NODE
apt-get update
apt-get install -y nodejs
npm install -g 'npm@^11.6.2'
mkdir -p /work/frontend
cp /src/package.json /src/package-lock.json /work/frontend/
cd /work/frontend
npm ci
tar -czf /out/frontend-node-modules.tar.gz node_modules
cd /work
npm pack --pack-destination /out 'npm@^11.6.2' >/dev/null
BUNDLE_NPM
  [[ -s "${output}/frontend-node-modules.tar.gz" ]] || {
    fail "Offline frontend node_modules archive was not produced in ${output}."
    return 1
  }
  compgen -G "${output}/npm-*.tgz" >/dev/null || {
    fail "Offline npm package was not produced in ${output}."
    return 1
  }
}

airgap_collect_compose_images() {
  local supabase_source="$1" output="$2"
  local livekit_dir="${SPARK_ROOT}/deploy/livekit"
  {
    (cd "${supabase_source}/docker" && docker compose --env-file .env.example -f docker-compose.yml config --images)
    (cd "$livekit_dir" && docker compose --env-file .env.example -f docker-compose.yml -f docker-compose.spark-cli.yml config --images)
  } | sed '/^[[:space:]]*$/d' | sort -u >"$output"
}

airgap_linux_amd64_registry_digest() {
  local image="$1" raw digest
  raw="$(docker buildx imagetools inspect --raw "$image")" || return 1
  digest="$(python3 -c '
import json, sys
obj = json.load(sys.stdin)
items = obj.get("manifests") or []
for item in items:
    p = item.get("platform") or {}
    if p.get("os") == "linux" and p.get("architecture") == "amd64" and p.get("variant") in (None, ""):
        d = item.get("digest")
        if d:
            print(d)
            raise SystemExit(0)
raise SystemExit(1)
' <<<"$raw" 2>/dev/null || true)"
  if [[ -n "$digest" ]]; then
    printf '%s\n' "$digest"
    return 0
  fi

  # Single-platform manifests have no child list. Use the registry digest and
  # validate os/arch after pulling it by digest.
  docker buildx imagetools inspect "$image" \
    | sed -n 's/^Digest:[[:space:]]*//p' | head -n1
}

airgap_digest_reference() {
  local image="$1" digest="$2"
  python3 - "$image" "$digest" <<'PY'
import sys
ref, digest = sys.argv[1], sys.argv[2]
ref = ref.split('@', 1)[0]
slash = ref.rfind('/')
colon = ref.rfind(':')
if colon > slash:
    ref = ref[:colon]
print(f"{ref}@{digest}")
PY
}

airgap_prepare_linux_amd64_image() {
  local image="$1" digest digest_ref image_id platform cid
  digest="$(airgap_linux_amd64_registry_digest "$image")" || {
    fail "Unable to resolve the linux/amd64 registry manifest for ${image}."
    return 1
  }
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    fail "Registry returned an invalid linux/amd64 digest for ${image}: ${digest:-missing}"
    return 1
  }
  digest_ref="$(airgap_digest_reference "$image" "$digest")" || return 1

  # Docker's containerd image store can report a platform as pulled while
  # docker save --platform cannot export it. Pull the exact child manifest by
  # digest and retag that single-platform image instead of relying on index
  # platform selection during export.
  docker image rm -f "$image" >/dev/null 2>&1 || true
  docker pull "$digest_ref" || return 1
  image_id="$(docker image inspect --format '{{.Id}}' "$digest_ref" 2>/dev/null || true)"
  [[ -n "$image_id" ]] || { fail "Pulled linux/amd64 image has no local image ID: ${image}"; return 1; }
  platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image_id" 2>/dev/null || true)"
  [[ "$platform" == "linux/amd64" ]] || {
    fail "Resolved image ${image} is not linux/amd64 after digest pull (reported: ${platform:-unknown})."
    return 1
  }
  docker tag "$image_id" "$image" || return 1

  # Exercise both export and daemon container creation before bundle assembly.
  docker image save "$image" >/dev/null || {
    fail "Docker image ${image} is not exportable after exact amd64 digest pull."
    return 1
  }
  cid="$(docker create --pull=never --entrypoint /bin/true "$image" 2>/dev/null)" || {
    fail "Docker image ${image} cannot create a container after exact amd64 digest pull."
    return 1
  }
  docker rm -f "$cid" >/dev/null 2>&1 || true
}

airgap_export_linux_amd64_images() {
  local list_file="$1" archive="$2" image platform
  local -a images=()
  mapfile -t images < <(sed '/^[[:space:]]*$/d' "$list_file")
  ((${#images[@]} > 0)) || { fail "Docker image manifest is empty."; return 1; }

  # Every external tag has already been normalized to an exact linux/amd64
  # child manifest. The locally-built Avatar image is validated here as well.
  for image in "${images[@]}"; do
    platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image" 2>/dev/null || true)"
    [[ "$platform" == "linux/amd64" ]] || {
      fail "Docker image ${image} is not the required linux/amd64 variant (reported: ${platform:-unknown})."
      return 1
    }
    docker image save "$image" >/dev/null || {
      fail "Docker image ${image} cannot be exported."
      return 1
    }
  done

  rm -f "$archive"
  docker image save "${images[@]}" | gzip -1 >"$archive" || return 1
  [[ -s "$archive" ]] || { fail "Docker image archive was not produced."; return 1; }
  gzip -t "$archive" || { fail "Docker image archive gzip integrity validation failed."; return 1; }
}

airgap_copy_certificate_pack() {
  local destination="$1" source="$2" domain src
  [[ -n "$source" && -d "$source" ]] || return 0
  mkdir -p "$destination"

  # Dedicated pack layout: <source>/<domain>/fullchain.pem + privkey.pem.
  if find "$source" -mindepth 2 -maxdepth 2 -type f -name fullchain.pem -print -quit | grep -q .; then
    while IFS= read -r src; do
      domain="$(basename "$(dirname "$src")")"
      [[ -f "$(dirname "$src")/privkey.pem" ]] || continue
      mkdir -p "${destination}/${domain}"
      cp -L "$src" "${destination}/${domain}/fullchain.pem"
      cp -L "$(dirname "$src")/privkey.pem" "${destination}/${domain}/privkey.pem"
      chmod 0600 "${destination}/${domain}/privkey.pem"
    done < <(find "$source" -mindepth 2 -maxdepth 2 -type f -name fullchain.pem | sort)
    return 0
  fi

  # Certbot root is accepted only when manager.conf identifies exact Spark domains.
  if [[ -d "${source}/live" && -f "$MANAGER_CONF" ]]; then
    local app api turn meet ingress cert_dir
    app="$(sed -n 's/^APP_DOMAIN=//p' "$MANAGER_CONF" | tail -n1)"
    api="$(sed -n 's/^API_DOMAIN=//p' "$MANAGER_CONF" | tail -n1)"
    turn="$(sed -n 's/^TURN_DOMAIN=//p' "$MANAGER_CONF" | tail -n1)"
    meet="meet.${app}"
    ingress="ingress.${app}"
    for domain in "$app" "$api" "$turn" "$meet" "$ingress"; do
      [[ -n "$domain" ]] || continue
      cert_dir=""
      for src in "${source}/live/${domain}" "${source}/live/${domain}-"*; do
        [[ -d "$src" && -f "$src/fullchain.pem" && -f "$src/privkey.pem" ]] || continue
        cert_dir="$src"; break
      done
      [[ -n "$cert_dir" ]] || continue
      mkdir -p "${destination}/${domain}"
      cp -L "${cert_dir}/fullchain.pem" "${destination}/${domain}/fullchain.pem"
      cp -L "${cert_dir}/privkey.pem" "${destination}/${domain}/privkey.pem"
      chmod 0600 "${destination}/${domain}/privkey.pem"
    done
    return 0
  fi

  fail "Certificate source must be a dedicated <domain>/fullchain.pem + privkey.pem pack, or a Certbot root with manager.conf present."
  return 1
}

airgap_build_bundle() {
  title
  new_log "airgap-build"
  local target_release output_root cert_source work bundle bundle_id spark_commit spark_short
  local supabase_source supabase_commit avatar_image created_at config_pack=0 cert_pack=0

  for cmd in git docker tar gzip sha256sum openssl python3; do
    command -v "$cmd" >/dev/null 2>&1 || { fail "Bundle builder requires: $cmd"; return 1; }
  done
  [[ -d "${SPARK_ROOT}/.git" ]] || { fail "Spark source repository is required at ${SPARK_ROOT}."; return 1; }
  [[ "$(git -C "$SPARK_ROOT" branch --show-current)" == "main" ]] || { fail "Spark bundle must be built from branch main."; return 1; }
  [[ -z "$(git -C "$SPARK_ROOT" status --porcelain)" ]] || { fail "Spark repository has uncommitted changes; bundle generation refused."; return 1; }
  docker info >/dev/null 2>&1 || { fail "Docker daemon is required on the connected bundle-builder host."; return 1; }

  . /etc/os-release
  airgap_prompt_default target_release "Target Ubuntu release" "${VERSION_ID:-26.04}"
  case "$target_release" in 24.04|26.04) ;; *) fail "Supported air-gap targets: Ubuntu 24.04 or 26.04."; return 1 ;; esac
  airgap_prompt_default output_root "Bundle output directory" "/var/backups/spark-airgap"
  cert_source=""
  if [[ -d /etc/letsencrypt && -f "$MANAGER_CONF" ]]; then
    airgap_prompt_default cert_source "TLS certificate pack source (type NONE to omit)" "/etc/letsencrypt"
    [[ "$cert_source" == "NONE" ]] && cert_source=""
  else
    read -r -p "TLS certificate pack source (optional, Enter to omit): " cert_source
  fi

  mkdir -p "$output_root"
  work="$(mktemp -d)"

  spark_commit="$(git -C "$SPARK_ROOT" rev-parse HEAD)"
  spark_short="${spark_commit:0:12}"
  created_at="$(date -u +%Y%m%dT%H%M%SZ)"
  bundle_id="spark-airgap-${spark_short}-ubuntu${target_release}-amd64-${created_at}"
  bundle="${work}/${bundle_id}"
  mkdir -p "$bundle"/{metadata,sources,apt,docker,npm,certificates,config}

  info "Creating Spark source bundle at ${spark_short}."
  git -C "$SPARK_ROOT" bundle create "${bundle}/sources/spark.git.bundle" main || return 1

  supabase_source="${work}/supabase-source"
  run_visible "Clone official Supabase master for offline snapshot" \
    git clone --branch master --single-branch https://github.com/supabase/supabase.git "$supabase_source" || return 1
  supabase_commit="$(git -C "$supabase_source" rev-parse HEAD)"
  git -C "$supabase_source" bundle create "${bundle}/sources/supabase.git.bundle" master || return 1

  run_visible "Build Ubuntu/Docker/Node offline APT payload" airgap_build_apt_payload "${bundle}/apt" "$target_release" || return 1

  run_visible "Build target-matched frontend/npm offline payload" \
    airgap_build_npm_payload "${bundle}/npm" "$target_release" || return 1

  avatar_image="spark/avatar-worker-airgap:${spark_short}"
  run_visible "Build pinned Avatar Worker image" docker build --platform linux/amd64 --pull --no-cache -t "$avatar_image" "${SPARK_ROOT}/worker" || return 1
  airgap_collect_compose_images "$supabase_source" "${bundle}/docker/images.txt" || return 1
  printf '%s\n' "$avatar_image" >>"${bundle}/docker/images.txt"
  sort -u -o "${bundle}/docker/images.txt" "${bundle}/docker/images.txt"

  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    [[ "$image" == "$avatar_image" ]] && continue
    run_visible "Resolve and pull exact linux/amd64 image ${image}" \
      airgap_prepare_linux_amd64_image "$image" || return 1
  done <"${bundle}/docker/images.txt"

  info "Validating and saving the linux/amd64 Docker image set. This can take several minutes."
  run_visible "Validate and export linux/amd64 Docker images" \
    airgap_export_linux_amd64_images "${bundle}/docker/images.txt" "${bundle}/docker/docker-images.tar.gz" || return 1
  : >"${bundle}/docker/image-ids.txt"
  while IFS= read -r image; do
    printf '%s %s\n' "$image" "$(docker image inspect --format '{{.Id}}' "$image")" >>"${bundle}/docker/image-ids.txt"
  done <"${bundle}/docker/images.txt"

  if [[ -f "$MANAGER_CONF" ]]; then
    cp "$MANAGER_CONF" "${bundle}/config/manager.conf"
    chmod 0600 "${bundle}/config/manager.conf"
    config_pack=1
  fi
  if [[ -n "$cert_source" ]]; then
    airgap_copy_certificate_pack "${bundle}/certificates" "$cert_source" || return 1
  fi
  if find "${bundle}/certificates" -mindepth 2 -maxdepth 2 -type f -name privkey.pem -print -quit | grep -q .; then cert_pack=1; fi

  cat >"${bundle}/metadata/manifest.env" <<EOF_META
FORMAT_VERSION=${AIRGAP_FORMAT_VERSION}
BUNDLE_ID=${bundle_id}
CREATED_AT=${created_at}
UBUNTU_VERSION=${target_release}
ARCH=amd64
SPARK_COMMIT=${spark_commit}
SUPABASE_BRANCH=master
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
  airgap_validate_checksum_manifest "$bundle" || return 1
  tar -C "$work" -czf "${output_root}/${bundle_id}.tar.gz" "$bundle_id" || return 1
  (cd "$output_root" && sha256sum "${bundle_id}.tar.gz" >"${bundle_id}.tar.gz.sha256")
  rm -rf "$work"

  ok "Air-gap bundle created: ${output_root}/${bundle_id}.tar.gz"
  printf 'Spark commit        : %s\n' "$spark_commit"
  printf 'Supabase commit     : %s\n' "$supabase_commit"
  printf 'Target              : Ubuntu %s / amd64\n' "$target_release"
  printf 'TLS certificate pack: %s\n' "$([[ "$cert_pack" == 1 ]] && echo INCLUDED || echo MISSING)"
  if [[ "$cert_pack" != 1 ]]; then
    warn "Package/source/image/npm installation is offline-ready, but complete Run All needs certificates for steps 13/19."
  fi
}
