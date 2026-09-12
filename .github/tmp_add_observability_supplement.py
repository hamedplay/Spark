from pathlib import Path

# 1) Add a checksum-verified observability-only image pack builder/importer.
p = Path('deploy/spark-cli/lib/airgap-build.sh')
s = p.read_text(encoding='utf-8')
marker = '\nairgap_build_bundle() {\n'
if marker not in s:
    raise SystemExit('airgap_build_bundle marker not found')
block = r'''
airgap_observability_image_list() {
  local env_file="${SPARK_ROOT}/deploy/livekit/.env.example"
  local key value
  local -a keys=(
    PROMETHEUS_IMAGE
    ALERTMANAGER_IMAGE
    GRAFANA_IMAGE
    LOKI_IMAGE
    ALLOY_IMAGE
    NODE_EXPORTER_IMAGE
    BLACKBOX_EXPORTER_IMAGE
  )
  [[ -f "$env_file" ]] || { fail "LiveKit .env.example is missing: ${env_file}"; return 1; }
  for key in "${keys[@]}"; do
    value="$(sed -n "s/^${key}=//p" "$env_file" | tail -n1)"
    [[ -n "$value" ]] || { fail "Observability image variable is missing: ${key}"; return 1; }
    printf '%s\n' "$value"
  done
}

airgap_build_observability_pack() {
  title
  new_log "airgap-build-observability-pack"
  command -v docker >/dev/null 2>&1 || { fail "Docker is required to build the observability image supplement."; return 1; }
  docker buildx version >/dev/null 2>&1 || { fail "Docker Buildx is required to resolve exact linux/amd64 image manifests."; return 1; }

  local output="${1:-}" work root list archive image image_id platform commit
  if [[ -z "$output" ]]; then
    airgap_prompt_default output "Output path for observability image supplement" \
      "$(pwd)/spark-observability-images-$(date +%Y%m%d-%H%M%S).tar.gz"
  fi
  [[ "$output" == /* ]] || output="$(pwd)/$output"
  install -d -m 0755 "$(dirname "$output")"

  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN
  root="${work}/spark-observability-images"
  install -d -m 0755 "$root"
  list="${root}/images.txt"
  archive="${root}/docker-images.tar.gz"

  airgap_observability_image_list | sort -u >"$list" || return 1
  [[ "$(wc -l <"$list" | tr -d '[:space:]')" == "7" ]] || {
    fail "Observability image supplement must contain exactly seven pinned images."
    return 1
  }

  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    info "Preparing exact linux/amd64 observability image: ${image}"
    airgap_prepare_linux_amd64_image "$image" || return 1
  done <"$list"

  run_logged "Export observability linux/amd64 Docker images" \
    airgap_export_linux_amd64_images "$list" "$archive" || return 1

  : >"${root}/image-ids.txt"
  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    image_id="$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)"
    platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image" 2>/dev/null || true)"
    [[ -n "$image_id" && "$platform" == "linux/amd64" ]] || {
      fail "Prepared observability image is not a readable linux/amd64 image: ${image}"
      return 1
    }
    printf '%s %s\n' "$image" "$image_id" >>"${root}/image-ids.txt"
  done <"$list"

  commit="$(git -C "$SPARK_ROOT" rev-parse HEAD 2>/dev/null || true)"
  cat >"${root}/manifest.env" <<EOF_OBS_MANIFEST
FORMAT_VERSION=1
PACK_TYPE=SPARK_OBSERVABILITY_IMAGE_SUPPLEMENT
ARCH=amd64
IMAGE_COUNT=7
SPARK_COMMIT=${commit}
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF_OBS_MANIFEST

  (
    cd "$root"
    sha256sum manifest.env images.txt image-ids.txt docker-images.tar.gz >SHA256SUMS
  )

  rm -f "$output"
  tar -czf "$output" -C "$work" spark-observability-images
  [[ -s "$output" ]] || { fail "Observability image supplement archive was not produced."; return 1; }
  ok "Observability image supplement created: ${output}"
  printf 'Contains 7 pinned linux/amd64 images for Step 22 only.\n'
}

airgap_import_observability_pack() {
  title
  new_log "airgap-import-observability-pack"
  local input="${1:-}" staging root type arch count image expected_id actual_id platform cid docker_bin
  [[ -n "$input" ]] || read -r -p "Path to observability image supplement .tar.gz: " input
  [[ -n "$input" && -f "$input" ]] || { fail "Observability image supplement path is required."; return 1; }
  input="$(readlink -f "$input")"
  docker_bin="${AIRGAP_REAL_DOCKER:-$(command -v docker || true)}"
  [[ -n "$docker_bin" && -x "$docker_bin" ]] || { fail "Docker is required to import the observability image supplement."; return 1; }

  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' RETURN
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    case "$entry" in
      /*|../*|*/../*|*'/..') fail "Unsafe path in observability image supplement: ${entry}"; return 1 ;;
    esac
  done < <(tar -tzf "$input")
  if tar -tvzf "$input" | awk '$1 ~ /^[lh]/ {found=1} END{exit !found}'; then
    fail "Observability image supplement contains symlink/hardlink entries."
    return 1
  fi
  tar -xzf "$input" -C "$staging"
  root="${staging}/spark-observability-images"
  for f in manifest.env images.txt image-ids.txt docker-images.tar.gz SHA256SUMS; do
    [[ -f "${root}/${f}" ]] || { fail "Observability supplement is missing: ${f}"; return 1; }
  done
  (cd "$root" && sha256sum -c SHA256SUMS) >>"$CURRENT_LOG" 2>&1 || {
    fail "Observability image supplement checksum validation failed."
    return 1
  }

  type="$(sed -n 's/^PACK_TYPE=//p' "${root}/manifest.env" | tail -n1)"
  arch="$(sed -n 's/^ARCH=//p' "${root}/manifest.env" | tail -n1)"
  count="$(sed -n 's/^IMAGE_COUNT=//p' "${root}/manifest.env" | tail -n1)"
  [[ "$type" == "SPARK_OBSERVABILITY_IMAGE_SUPPLEMENT" ]] || { fail "Unsupported observability supplement type."; return 1; }
  [[ "$arch" == "amd64" ]] || { fail "Observability supplement architecture must be amd64."; return 1; }
  [[ "$count" == "7" ]] || { fail "Observability supplement image count is invalid."; return 1; }
  [[ "$(wc -l <"${root}/images.txt" | tr -d '[:space:]')" == "7" ]] || { fail "Observability supplement image manifest is incomplete."; return 1; }

  run_visible "Load observability Docker image supplement" bash -c \
    "gzip -dc '$root/docker-images.tar.gz' | '$docker_bin' image load" || return 1

  while read -r image expected_id; do
    [[ -n "$image" && -n "$expected_id" ]] || continue
    actual_id="$("$docker_bin" image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)"
    platform="$("$docker_bin" image inspect --format '{{.Os}}/{{.Architecture}}' "$image" 2>/dev/null || true)"
    [[ "$actual_id" == "$expected_id" && "$platform" == "linux/amd64" ]] || {
      fail "Imported observability image does not match the verified manifest: ${image}"
      return 1
    }
    cid="$("$docker_bin" create --pull=never --entrypoint /bin/true "$image" 2>>"$CURRENT_LOG")" || {
      fail "Imported observability image cannot create a container: ${image}"
      return 1
    }
    "$docker_bin" rm -f "$cid" >/dev/null 2>&1 || true
  done <"${root}/image-ids.txt"

  ok "Observability image supplement imported and container-create validated."
  printf 'Run Installation Air-Gap -> Step 22 again.\n'
}
'''
s = s.replace(marker, '\n' + block + marker, 1)
p.write_text(s, encoding='utf-8')

# 2) Wire backend actions and CLI flags.
p = Path('deploy/spark-cli/spark-airgap')
s = p.read_text(encoding='utf-8')
s = s.replace(
    '    airgap-auto-target-bootstrap) airgap_auto_apply_and_bootstrap "${1:-}" "${2:-}" ;;\n',
    '    airgap-auto-target-bootstrap) airgap_auto_apply_and_bootstrap "${1:-}" "${2:-}" ;;\n'
    '    airgap-build-observability-pack) airgap_build_observability_pack "${1:-}" ;;\n'
    '    airgap-import-observability-pack) airgap_import_observability_pack "${1:-}" ;;\n',
    1,
)
s = s.replace(
    '  --auto-target-bootstrap)\n    shift\n    spark_airgap_backend_action airgap-auto-target-bootstrap "${1:-}" "${2:-}"\n    ;;\n',
    '  --auto-target-bootstrap)\n    shift\n    spark_airgap_backend_action airgap-auto-target-bootstrap "${1:-}" "${2:-}"\n    ;;\n'
    '  --build-observability-pack)\n    shift\n    spark_airgap_backend_action airgap-build-observability-pack "${1:-}"\n    ;;\n'
    '  --import-observability-pack)\n    shift\n    spark_airgap_backend_action airgap-import-observability-pack "${1:-}"\n    ;;\n',
    1,
)
s = s.replace(
    '  --auto-target-bootstrap [base] [patch]\n                                       Auto-discover/match artifacts, apply the target patch and run offline bootstrap\n  --version',
    '  --auto-target-bootstrap [base] [patch]\n                                       Auto-discover/match artifacts, apply the target patch and run offline bootstrap\n'
    '  --build-observability-pack [output] Build only the seven Step 22 observability images on a connected host\n'
    '  --import-observability-pack [pack]  Verify/load a local observability image supplement on the target\n'
    '  --version',
    1,
)
for needle in ('airgap-build-observability-pack)', 'airgap-import-observability-pack)', '--build-observability-pack', '--import-observability-pack'):
    if needle not in s:
        raise SystemExit(f'missing spark-airgap wiring: {needle}')
p.write_text(s, encoding='utf-8')

# 3) Add English-only UI actions and self-test requirements.
p = Path('deploy/spark-cli/spark-ui.py')
s = p.read_text(encoding='utf-8')
needle = '''    core.Action(
        "airgap-auto-target-bootstrap",
        "09  Auto prepare + bootstrap offline target",
        "Automatically find matching artifacts, verify them, prepare the target bundle, install local packages and import Docker images.",
        "controlled",
    ),
]'''
replacement = '''    core.Action(
        "airgap-auto-target-bootstrap",
        "09  Auto prepare + bootstrap offline target",
        "Automatically find matching artifacts, verify them, prepare the target bundle, install local packages and import Docker images.",
        "controlled",
    ),
    core.Action(
        "airgap-build-observability-pack",
        "10  Build observability image supplement",
        "Build only the seven pinned linux/amd64 Docker images required by Step 22 on a connected staging host.",
        "controlled",
    ),
    core.Action(
        "airgap-import-observability-pack",
        "11  Import observability image supplement",
        "Verify and load a checksum-protected Step 22 observability image supplement without replacing the active Air-Gap bundle.",
        "controlled",
    ),
]'''
if s.count(needle) != 1:
    raise SystemExit('AIRGAP_ACTIONS tail marker not found exactly once')
s = s.replace(needle, replacement, 1)
required_seq = '''        "airgap-build-target-patch",
        "airgap-apply-target-patch",
        "airgap-auto-target-bootstrap",
'''
required_new = required_seq + '''        "airgap-build-observability-pack",
        "airgap-import-observability-pack",
'''
if s.count(required_seq) != 1:
    raise SystemExit('self-test airgap required sequence missing')
s = s.replace(required_seq, required_new, 1)
p.write_text(s, encoding='utf-8')

print('Observability supplement patch: PASS')
