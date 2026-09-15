# Edge Functions Air-Gap v2: exact-runtime DENO_DIR integration.
#
# One complete Air-Gap bundle now carries:
#   - the original Spark Edge Function TypeScript sources;
#   - the Supabase deno.jsonc that the pinned Edge Runtime expects;
#   - Spark's offline-safe main router;
#   - a DENO_DIR pre-warmed with the exact Deno version embedded in the
#     pinned Supabase Edge Runtime image.
#
# This file is loaded last by spark-airgap, so it deliberately overrides the
# legacy bundle-based Edge Function implementation and the relevant Air-Gap
# validation/install hooks.

AIRGAP_FORMAT_VERSION="2"
AIRGAP_EDGE_PACK_FORMAT_VERSION="2"
AIRGAP_EDGE_CACHE_MODE="DENO_DIR"
AIRGAP_EDGE_PAYLOAD_FORMAT_VERSION="2"
AIRGAP_EDGE_FUNCTIONS_CONTAINER="supabase-edge-functions"

# Capture the implementations that existed before this late override.
eval "$(declare -f airgap_build_npm_payload | sed '1s/airgap_build_npm_payload/airgap_build_npm_payload_without_edge_v2/')"
eval "$(declare -f airgap_validate_checksum_manifest | sed '1s/airgap_validate_checksum_manifest/airgap_validate_checksum_manifest_base_v2/')"
eval "$(declare -f airgap_validate_bundle_dir | sed '1s/airgap_validate_bundle_dir/airgap_validate_bundle_dir_base_v2/')"
eval "$(declare -f install_step_7 | sed '1s/install_step_7/install_step_7_base_v2/')"
eval "$(declare -f install_step_10 | sed '1s/install_step_10/install_step_10_airgap_base_v2/')"

_airgap_edge_meta_from() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 1
  sed -n "s/^${key}=//p" "$file" | tail -n1
}

_airgap_edge_runtime_image_from_compose() {
  local compose_file="$1"
  awk '
    /^  functions:[[:space:]]*$/ { in_functions=1; next }
    in_functions && /^    image:[[:space:]]*/ {
      sub(/^    image:[[:space:]]*/, "")
      gsub(/["\047]/, "")
      print
      exit
    }
    in_functions && /^  [A-Za-z0-9_.-]+:[[:space:]]*$/ { exit }
  ' "$compose_file"
}

_airgap_edge_write_json_manifest() {
  local env_file="$1" json_file="$2"
  ENV_FILE="$env_file" JSON_FILE="$json_file" python3 - <<'PY'
import json, os
from pathlib import Path
values = {}
for line in Path(os.environ['ENV_FILE']).read_text(encoding='utf-8').splitlines():
    if '=' in line:
        k, v = line.split('=', 1)
        values[k] = v
Path(os.environ['JSON_FILE']).write_text(
    json.dumps(values, indent=2, sort_keys=True) + "\n",
    encoding='utf-8',
)
PY
}

_airgap_edge_cache_dependencies() {
  local source_dir="$1" cache_dir="$2" deno_image="$3"

  rm -rf "$cache_dir"
  mkdir -p "$cache_dir"

  info "Pre-warming Edge Function DENO_DIR with ${deno_image}."
  docker pull --platform linux/amd64 "$deno_image" || return 1

  # Connected pass. Mount the source at the exact path used by Edge Runtime so
  # URL/config resolution and relative module paths are identical on the bank.
  docker run --rm --platform linux/amd64 \
    -e DENO_DIR=/root/.cache/deno \
    -v "${source_dir}:/home/deno/functions:ro" \
    -v "${cache_dir}:/root/.cache/deno" \
    --entrypoint sh "$deno_image" -c '
set -eu
config=/home/deno/functions/deno.jsonc
[ -f "$config" ]
count=0
for entry in /home/deno/functions/*/index.ts; do
  [ -f "$entry" ] || continue
  deno cache --config "$config" --no-lock "$entry"
  count=$((count + 1))
done
[ "$count" -gt 0 ]
printf "Cached dependency graphs for %s Edge Runtime entrypoints.\n" "$count"
' || {
    fail "Unable to pre-warm the Edge Function DENO_DIR."
    return 1
  }

  # Disconnected proof. If a single JSR/npm/http import is absent from the
  # cache, Deno must fail here before the bundle is allowed to exist.
  docker run --rm --platform linux/amd64 --network none \
    -e DENO_DIR=/root/.cache/deno \
    -v "${source_dir}:/home/deno/functions:ro" \
    -v "${cache_dir}:/root/.cache/deno" \
    --entrypoint sh "$deno_image" -c '
set -eu
config=/home/deno/functions/deno.jsonc
[ -f "$config" ]
count=0
for entry in /home/deno/functions/*/index.ts; do
  [ -f "$entry" ] || continue
  deno cache --config "$config" --cached-only --no-lock "$entry"
  count=$((count + 1))
done
[ "$count" -gt 0 ]
printf "Offline cached-only dependency proof passed for %s Edge Runtime entrypoints.\n" "$count"
' || {
    fail "Offline cached-only Edge Function dependency verification failed."
    return 1
  }

  [[ -n "$(find "$cache_dir" -mindepth 1 -print -quit)" ]] || {
    fail "Deno dependency cache is empty after the connected cache pass."
    return 1
  }
}

_airgap_edge_build_payload() {
  local bundle_root="$1" spark_source="$2" supabase_source="$3"
  local functions_dir="${bundle_root}/edge-functions"
  local cache_dir="${bundle_root}/deno-cache"
  local edge_meta="${bundle_root}/metadata/edge-runtime.env"
  local edge_json="${bundle_root}/metadata/edge-runtime.json"
  local compose_file="${supabase_source}/docker/docker-compose.yml"
  local supabase_deno="${supabase_source}/docker/volumes/functions/deno.jsonc"
  local spark_router="${spark_source}/deploy/spark-cli/edge-main/index.ts"
  local runtime_image runtime_image_id runtime_platform target_deno deno_image actual_deno
  local spark_commit supabase_commit count entrypoints cache_files cache_bytes

  require_dir "${spark_source}/supabase/functions" || return 1
  require_file "$compose_file" || return 1
  require_file "$spark_router" || return 1

  rm -rf "$functions_dir" "$cache_dir"
  mkdir -p "$functions_dir" "$cache_dir" "${bundle_root}/metadata"
  cp -a "${spark_source}/supabase/functions/." "$functions_dir/" || return 1

  # Edge Runtime v1.76.x points every user worker at this common import map.
  # Keep the exact file from the same pinned Supabase source snapshot.
  if [[ -f "$supabase_deno" ]]; then
    install -m 0644 "$supabase_deno" "${functions_dir}/deno.jsonc" || return 1
  else
    # Older Supabase snapshots did not ship the file. An empty local import map
    # is still preferable to a missing path because Spark functions use explicit
    # specifiers; the offline cache proof below remains authoritative.
    printf '{"imports":{}}\n' >"${functions_dir}/deno.jsonc"
    chmod 0644 "${functions_dir}/deno.jsonc"
  fi

  # Ship the offline-safe router inside the authoritative payload instead of
  # restoring Supabase's network-dependent jsr:@panva/jose router on Step 7.
  rm -rf "${functions_dir}/main"
  mkdir -p "${functions_dir}/main"
  install -m 0644 "$spark_router" "${functions_dir}/main/index.ts" || return 1

  : >"${functions_dir}/.spark-bundled-functions"
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    basename "$(dirname "$entry")"
  done < <(find "${spark_source}/supabase/functions" -mindepth 2 -maxdepth 2 -type f -name index.ts | sort) \
    >"${functions_dir}/.spark-bundled-functions"

  count="$(wc -l <"${functions_dir}/.spark-bundled-functions" | tr -d '[:space:]')"
  entrypoints="$(find "$functions_dir" -mindepth 2 -maxdepth 2 -type f -name index.ts | wc -l | tr -d '[:space:]')"
  [[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]] || {
    fail "Edge Function source inventory is empty."
    return 1
  }
  [[ "$entrypoints" =~ ^[0-9]+$ && "$entrypoints" -eq $((count + 1)) ]] || {
    fail "Edge Runtime payload entrypoint count is inconsistent (functions=${count}, entrypoints=${entrypoints:-0})."
    return 1
  }

  runtime_image="$(_airgap_edge_runtime_image_from_compose "$compose_file")"
  [[ -n "$runtime_image" ]] || {
    fail "Unable to resolve the Supabase Edge Runtime image from the pinned Compose file."
    return 1
  }

  # Normalize before recording identity, using the same single-platform path as
  # the Docker payload. A platform pull can retain a multi-platform index in the
  # containerd store; retagging its child later can change the reported identity.
  # The full builder reuses this exact image instead of resolving the tag twice.
  airgap_prepare_linux_amd64_image "$runtime_image" || return 1
  runtime_image_id="$(docker image inspect --format '{{.Id}}' "$runtime_image" 2>/dev/null || true)"
  runtime_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$runtime_image" 2>/dev/null || true)"
  [[ "$runtime_image_id" =~ ^sha256:[0-9a-f]{64}$ && "$runtime_platform" == "linux/amd64" ]] || {
    fail "Target Edge Runtime is not a readable linux/amd64 image: ${runtime_image}."
    return 1
  }

  target_deno="$(docker run --rm --pull=never --platform linux/amd64 --entrypoint edge-runtime "$runtime_image_id" --version 2>/dev/null \
    | awk '$1=="deno" {print $2; exit}')"
  [[ "$target_deno" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    fail "Unable to determine embedded Deno version from ${runtime_image}."
    return 1
  }

  deno_image="denoland/deno:${target_deno}"
  docker pull --platform linux/amd64 "$deno_image" || return 1
  actual_deno="$(docker run --rm --platform linux/amd64 --entrypoint deno "$deno_image" --version 2>/dev/null \
    | awk '$1=="deno" {print $2; exit}')"
  [[ "$actual_deno" == "$target_deno" ]] || {
    fail "Deno builder/runtime mismatch: builder=${actual_deno:-unknown}, target=${target_deno}."
    return 1
  }

  _airgap_edge_cache_dependencies "$functions_dir" "$cache_dir" "$deno_image" || return 1

  cache_files="$(find "$cache_dir" -type f | wc -l | tr -d '[:space:]')"
  cache_bytes="$(du -sb "$cache_dir" | awk '{print $1}')"
  [[ "$cache_files" =~ ^[0-9]+$ && "$cache_files" -gt 0 ]] || {
    fail "Deno dependency cache contains no files."
    return 1
  }

  spark_commit="$(git -C "$spark_source" rev-parse HEAD)" || return 1
  supabase_commit="$(git -C "$supabase_source" rev-parse HEAD)" || return 1

  cat >"$edge_meta" <<EOF_EDGE_META
PAYLOAD_FORMAT_VERSION=${AIRGAP_EDGE_PAYLOAD_FORMAT_VERSION}
PAYLOAD_MODE=${AIRGAP_EDGE_CACHE_MODE}
SPARK_COMMIT=${spark_commit}
SUPABASE_COMMIT=${supabase_commit}
EDGE_RUNTIME_IMAGE=${runtime_image}
EDGE_RUNTIME_IMAGE_ID=${runtime_image_id}
TARGET_DENO_VERSION=${target_deno}
DENO_IMAGE=${deno_image}
FUNCTION_COUNT=${count}
ENTRYPOINT_COUNT=${entrypoints}
DENO_CACHE_FILES=${cache_files}
DENO_CACHE_BYTES=${cache_bytes}
EOF_EDGE_META
  chmod 0600 "$edge_meta"
  _airgap_edge_write_json_manifest "$edge_meta" "$edge_json" || return 1

  info "Embedded Edge Runtime payload ready: ${count} functions, ${entrypoints} entrypoints, Deno ${target_deno}, ${cache_files} cached files."
}

_airgap_edge_validate_payload() {
  local root="$1" meta="${1}/metadata/edge-runtime.env"
  local mode fmt spark_commit supabase_commit main_spark main_supabase
  local image image_id image_list_id deno count entrypoints cache_files actual_cache_files

  for path in \
    edge-functions/.spark-bundled-functions \
    edge-functions/deno.jsonc \
    edge-functions/main/index.ts \
    metadata/edge-runtime.env \
    metadata/edge-runtime.json; do
    [[ -f "${root}/${path}" ]] || { fail "Air-gap Edge Runtime artifact missing: ${root}/${path}"; return 1; }
  done
  [[ -d "${root}/deno-cache" ]] || { fail "Air-gap DENO_DIR payload is missing: ${root}/deno-cache"; return 1; }

  fmt="$(_airgap_edge_meta_from "$meta" PAYLOAD_FORMAT_VERSION)"
  mode="$(_airgap_edge_meta_from "$meta" PAYLOAD_MODE)"
  spark_commit="$(_airgap_edge_meta_from "$meta" SPARK_COMMIT)"
  supabase_commit="$(_airgap_edge_meta_from "$meta" SUPABASE_COMMIT)"
  image="$(_airgap_edge_meta_from "$meta" EDGE_RUNTIME_IMAGE)"
  image_id="$(_airgap_edge_meta_from "$meta" EDGE_RUNTIME_IMAGE_ID)"
  deno="$(_airgap_edge_meta_from "$meta" TARGET_DENO_VERSION)"
  count="$(_airgap_edge_meta_from "$meta" FUNCTION_COUNT)"
  entrypoints="$(_airgap_edge_meta_from "$meta" ENTRYPOINT_COUNT)"
  cache_files="$(_airgap_edge_meta_from "$meta" DENO_CACHE_FILES)"

  [[ "$fmt" == "$AIRGAP_EDGE_PAYLOAD_FORMAT_VERSION" && "$mode" == "$AIRGAP_EDGE_CACHE_MODE" ]] || {
    fail "Unsupported embedded Edge Runtime payload metadata."
    return 1
  }
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ && "$deno" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    fail "Embedded Edge Runtime identity metadata is invalid."
    return 1
  }
  [[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 && "$entrypoints" =~ ^[0-9]+$ && "$entrypoints" -eq $((count + 1)) ]] || {
    fail "Embedded Edge Runtime function inventory is invalid."
    return 1
  }
  [[ "$(wc -l <"${root}/edge-functions/.spark-bundled-functions" | tr -d '[:space:]')" == "$count" ]] || {
    fail "Embedded Edge Runtime inventory count mismatch."
    return 1
  }
  python3 - "$root" "$entrypoints" <<'PY' || return 1
from pathlib import Path
import re, sys
functions = Path(sys.argv[1]) / 'edge-functions'
names = (functions / '.spark-bundled-functions').read_text().splitlines()
if len(names) != len(set(names)) or any(not re.fullmatch(r'[A-Za-z0-9_-]+', n) or n == 'main' for n in names):
    raise SystemExit('Invalid or duplicate Edge Function inventory')
actual = {p.parent.name for p in functions.glob('*/index.ts') if p.is_file()}
if actual != set(names) | {'main'} or len(actual) != int(sys.argv[2]):
    raise SystemExit('Edge Function source files do not match the bundled inventory')
PY
  actual_cache_files="$(find "${root}/deno-cache" -type f | wc -l | tr -d '[:space:]')"
  [[ "$cache_files" =~ ^[0-9]+$ && "$cache_files" -gt 0 && "$actual_cache_files" == "$cache_files" ]] || {
    fail "Embedded DENO_DIR file count mismatch."
    return 1
  }

  # The payload is tied to the exact source snapshots carried by the same bundle.
  if [[ -f "${root}/metadata/manifest.env" ]]; then
    main_spark="$(airgap_meta_from "$root" SPARK_COMMIT)"
    main_supabase="$(airgap_meta_from "$root" SUPABASE_COMMIT)"
    [[ "$spark_commit" == "$main_spark" && "$supabase_commit" == "$main_supabase" ]] || {
      fail "Embedded Edge Runtime source identity does not match the bundle manifest."
      return 1
    }
  fi

  grep -Fq 'Spark offline-safe main function started' "${root}/edge-functions/main/index.ts" || {
    fail "Embedded Edge Runtime main router is not Spark offline-safe."
    return 1
  }
  if grep -Eq '(^|[[:space:]])import[[:space:]].*(https?://|jsr:|npm:)' "${root}/edge-functions/main/index.ts"; then
    fail "Embedded main router contains a remote dependency."
    return 1
  fi

  # Once image-ids.txt exists, bind the cache to the exact image exported in the
  # same 7GB archive. A moving registry tag can therefore never silently pass.
  if [[ -f "${root}/docker/image-ids.txt" ]]; then
    image_list_id="$(awk -v img="$image" '$1==img {print $2; exit}' "${root}/docker/image-ids.txt")"
    [[ "$image_list_id" == "$image_id" ]] || {
      fail "Edge Runtime image ID used for DENO_DIR does not match the image exported in the bundle (${image})."
      return 1
    }
  fi
}

# Full bundle hook: build ordinary frontend npm payload, then add the complete
# Edge Runtime source/cache payload inside the same archive. Target patches only
# replace OS-dependent apt/npm assets and intentionally reuse the base payload.
airgap_build_npm_payload() {
  local output="$1" parent bundle_root work_root supabase_source bootstrap_source
  airgap_build_npm_payload_without_edge_v2 "$@" || return 1

  parent="$(basename "$(dirname "$output")")"
  if [[ "$parent" == spark-airgap-target-patch-* ]]; then
    info "Target patch reuses the base bundle Edge Runtime payload."
    return 0
  fi

  bundle_root="$(dirname "$output")"
  work_root="$(dirname "$bundle_root")"
  supabase_source="${work_root}/supabase-source"
  [[ -d "${supabase_source}/.git" ]] || {
    fail "Pinned Supabase builder checkout is missing beside the bundle workspace: ${supabase_source}"
    return 1
  }

  _airgap_edge_build_payload "$bundle_root" "$SPARK_ROOT" "$supabase_source" || return 1

  bootstrap_source="${SPARK_ROOT}/deploy/spark-cli/bootstrap-airgap-bundle.sh"
  [[ -f "$bootstrap_source" ]] || {
    fail "Self-contained bundle bootstrap is missing: ${bootstrap_source}"
    return 1
  }
  install -m 0755 "$bootstrap_source" "${bundle_root}/bootstrap.sh" || return 1
}

# Strengthen every format-v2 bundle checksum validation with structural and
# Edge Runtime/image identity validation.
airgap_validate_checksum_manifest() {
  local root="$1"
  airgap_validate_checksum_manifest_base_v2 "$root" || return 1
  if [[ "$(_airgap_edge_meta_from "${root}/metadata/manifest.env" FORMAT_VERSION 2>/dev/null || true)" == "2" ]]; then
    _airgap_edge_validate_payload "$root" || return 1
  fi
}

airgap_validate_bundle_dir() {
  local root="$1"
  airgap_validate_bundle_dir_base_v2 "$root" || return 1
  _airgap_edge_validate_payload "$root" || return 1
  airgap_require_file "${root}/bootstrap.sh" || return 1
}

_airgap_edge_verify_payload_against_restored_sources() {
  local root="$1"
  diff -qr --exclude=main --exclude=deno.jsonc --exclude=.spark-bundled-functions \
    "${root}/edge-functions" "${SPARK_ROOT}/supabase/functions" || return 1
  if [[ -f "${SUPABASE_SOURCE}/docker/volumes/functions/deno.jsonc" ]]; then
    cmp -s "${root}/edge-functions/deno.jsonc" "${SUPABASE_SOURCE}/docker/volumes/functions/deno.jsonc" || return 1
  fi
  cmp -s "${root}/edge-functions/main/index.ts" "$SPARK_EDGE_MAIN_ROUTER" || return 1
}

install_step_7() {
  airgap_is_active || { install_step_7_base_v2; return; }
  title
  new_log "install-07-functions-airgap-v2"
  local root payload count

  root="$(airgap_current_root)" || { fail "No active air-gap bundle."; return 1; }
  _airgap_edge_validate_payload "$root" || return 1
  _airgap_edge_verify_payload_against_restored_sources "$root" || {
    fail "Embedded Edge Function sources do not match the Spark/Supabase snapshots restored from this bundle."
    return 1
  }

  payload="${root}/edge-functions"
  count="$(wc -l <"${payload}/.spark-bundled-functions" | tr -d '[:space:]')"
  mkdir -p "${SUPABASE_ROOT}/volumes/functions"
  run_logged "Install exact offline Edge Runtime source tree" \
    rsync -a --delete "${payload}/" "${SUPABASE_ROOT}/volumes/functions/" || return 1

  if ! diff -qr "$payload" "${SUPABASE_ROOT}/volumes/functions" >>"$CURRENT_LOG" 2>&1; then
    unmark_step 7
    fail "Installed Edge Runtime source tree differs from the verified bundle payload."
    return 1
  fi

  mark_step 7
  ok "${count} Edge Functions, Supabase deno.jsonc, and Spark offline-safe main router installed from the verified bundle."
}

_airgap_edge_capture_logs() {
  local destination="$1"
  docker logs --since 10m "$AIRGAP_EDGE_FUNCTIONS_CONTAINER" >"$destination" 2>&1 || true
  [[ -n "${CURRENT_LOG:-}" ]] && {
    printf '\n=== Edge Runtime failure diagnostics ===\n' >>"$CURRENT_LOG"
    tail -n 160 "$destination" >>"$CURRENT_LOG" 2>&1 || true
  }
}

_airgap_edge_seed_live_cache() {
  local root="$1" meta="${1}/metadata/edge-runtime.env"
  local expected_image expected_image_id expected_deno expected_cache_files
  local functions_mount expected_functions_mount cache_type cache_name cache_destination
  local actual_image actual_image_id actual_deno runtime

  expected_image="$(_airgap_edge_meta_from "$meta" EDGE_RUNTIME_IMAGE)"
  expected_image_id="$(_airgap_edge_meta_from "$meta" EDGE_RUNTIME_IMAGE_ID)"
  expected_deno="$(_airgap_edge_meta_from "$meta" TARGET_DENO_VERSION)"
  expected_cache_files="$(_airgap_edge_meta_from "$meta" DENO_CACHE_FILES)"

  functions_mount="$(docker inspect "$AIRGAP_EDGE_FUNCTIONS_CONTAINER" \
    --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
  [[ -n "$functions_mount" && -d "$functions_mount" ]] || {
    fail "Unable to resolve live /home/deno/functions mount from ${AIRGAP_EDGE_FUNCTIONS_CONTAINER}."
    return 1
  }
  functions_mount="$(readlink -f "$functions_mount")"
  expected_functions_mount="$(readlink -f "${SUPABASE_ROOT}/volumes/functions")"
  [[ "$functions_mount" == "$expected_functions_mount" ]] || {
    fail "Edge Runtime functions mount is ${functions_mount}; expected authoritative Spark runtime ${expected_functions_mount}."
    return 1
  }
  runtime="$(dirname "$(dirname "$functions_mount")")"
  [[ "$(readlink -f "$runtime")" == "$(readlink -f "$SUPABASE_ROOT")" ]] || {
    fail "Live Edge Runtime resolved to unexpected Supabase root: ${runtime}."
    return 1
  }

  cache_type="$(docker inspect "$AIRGAP_EDGE_FUNCTIONS_CONTAINER" \
    --format '{{range .Mounts}}{{if eq .Destination "/root/.cache/deno"}}{{.Type}}{{end}}{{end}}' 2>/dev/null || true)"
  cache_name="$(docker inspect "$AIRGAP_EDGE_FUNCTIONS_CONTAINER" \
    --format '{{range .Mounts}}{{if eq .Destination "/root/.cache/deno"}}{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' 2>/dev/null || true)"
  cache_destination="$(docker inspect "$AIRGAP_EDGE_FUNCTIONS_CONTAINER" \
    --format '{{range .Mounts}}{{if eq .Destination "/root/.cache/deno"}}{{.Destination}}{{end}}{{end}}' 2>/dev/null || true)"
  [[ "$cache_type" == "volume" && "$cache_destination" == "/root/.cache/deno" && -n "$cache_name" ]] || {
    fail "Live Edge Runtime does not expose the expected persistent named DENO_DIR volume."
    return 1
  }

  actual_image="$(docker inspect "$AIRGAP_EDGE_FUNCTIONS_CONTAINER" --format '{{.Config.Image}}' 2>/dev/null || true)"
  actual_image_id="$(docker inspect "$AIRGAP_EDGE_FUNCTIONS_CONTAINER" --format '{{.Image}}' 2>/dev/null || true)"
  actual_deno="$(docker exec "$AIRGAP_EDGE_FUNCTIONS_CONTAINER" edge-runtime --version 2>/dev/null \
    | awk '$1=="deno" {print $2; exit}')"
  [[ "$actual_image" == "$expected_image" && "$actual_image_id" == "$expected_image_id" ]] || {
    fail "Live Edge Runtime image differs from the image used to build the offline cache."
    return 1
  }
  [[ "$actual_deno" == "$expected_deno" ]] || {
    fail "Embedded Deno mismatch: bundle=${expected_deno}, live=${actual_deno:-unknown}."
    return 1
  }

  # Stop the worker before replacing DENO_DIR so no live isolate observes a
  # partially seeded cache. Seed through a helper container using the exact
  # already-imported Edge Runtime image; no network is available or required.
  docker compose --env-file "${runtime}/.env" -f "${runtime}/docker-compose.yml" stop functions >>"$CURRENT_LOG" 2>&1 || return 1

  if ! docker run --rm --network none \
    -v "${cache_name}:/cache" \
    -v "${root}/deno-cache:/seed:ro" \
    --entrypoint sh "$expected_image" -c '
set -eu
find /cache -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -a /seed/. /cache/
' >>"$CURRENT_LOG" 2>&1; then
    docker compose --env-file "${runtime}/.env" -f "${runtime}/docker-compose.yml" start functions >>"$CURRENT_LOG" 2>&1 || true
    fail "Unable to seed the persistent Edge Runtime DENO_DIR volume."
    return 1
  fi

  docker compose --env-file "${runtime}/.env" -f "${runtime}/docker-compose.yml" start functions >>"$CURRENT_LOG" 2>&1 || return 1

  # Verify the named volume itself, not a container filesystem view.
  local actual_cache_files
  actual_cache_files="$(docker run --rm --network none -v "${cache_name}:/cache:ro" --entrypoint sh "$expected_image" \
    -c 'find /cache -type f | wc -l | tr -d "[:space:]"' 2>/dev/null || true)"
  [[ "$actual_cache_files" == "$expected_cache_files" ]] || {
    fail "Seeded DENO_DIR file count mismatch: expected=${expected_cache_files}, actual=${actual_cache_files:-unknown}."
    return 1
  }
}

_airgap_edge_runtime_probe() {
  local runtime="$1" anon probe code
  anon="$(env_get "${runtime}/.env" ANON_KEY)"
  [[ -n "$anon" ]] || { fail "ANON_KEY is missing from active Supabase runtime."; return 1; }
  probe="$(mktemp)"
  code="$(curl --noproxy '*' -sS --connect-timeout 5 --max-time 20 \
    -o "$probe" -w '%{http_code}' \
    -X OPTIONS \
    -H "apikey: ${anon}" \
    -H "Authorization: Bearer ${anon}" \
    http://127.0.0.1:8000/functions/v1/auth-health-check || true)"
  rm -f "$probe"
  [[ "$code" == "204" ]] || {
    fail "Offline Edge Runtime dependency probe failed (expected HTTP 204, got ${code:-000})."
    return 1
  }
}

install_step_10() {
  airgap_is_active || { install_step_10_airgap_base_v2; return; }

  # First start the pinned Supabase stack using the existing hardened Air-Gap
  # path. Its TCP healthcheck does not execute a user function, so cache seeding
  # is performed immediately afterwards and followed by a real worker probe.
  install_step_10_airgap_base_v2 || return 1

  local root runtime failure_log
  root="$(airgap_current_root)" || { unmark_step 10; fail "No active air-gap bundle."; return 1; }
  runtime="$SUPABASE_ROOT"
  failure_log="${BACKUP_DIR}/edge-runtime-step10-$(date -u +%Y%m%d-%H%M%S).log"

  if ! _airgap_edge_validate_payload "$root"; then
    unmark_step 10
    return 1
  fi
  if ! _airgap_edge_seed_live_cache "$root"; then
    _airgap_edge_capture_logs "$failure_log"
    unmark_step 10
    fail "Edge Runtime cache activation failed. Diagnostics: ${failure_log}"
    return 1
  fi

  sleep 3
  if ! _airgap_edge_runtime_probe "$runtime"; then
    _airgap_edge_capture_logs "$failure_log"
    unmark_step 10
    fail "Edge Runtime source/cache validation failed. Diagnostics: ${failure_log}"
    return 1
  fi

  mark_step 10
  ok "Supabase Edge Runtime is offline-ready: exact image, exact Deno, verified DENO_DIR, HTTP 204 worker cold-start probe."
}

# Maintenance supplement builder. New full bundles no longer require this path,
# but keeping it deterministic is useful for servicing an already transferred
# format-v2 base without retransferring Docker images.
airgap_build_edge_functions_pack() (
  title
  new_log "airgap-build-edge-functions-pack-v2"
  local base_input="${1:-}" output="${2:-}" work base_stage base_root base_id base_commit base_supabase_commit
  local source supabase_source supabase_branch created_at pack_id root edge_meta count

  for cmd in docker git tar gzip sha256sum python3 awk find; do
    command -v "$cmd" >/dev/null 2>&1 || { fail "Edge Functions supplement builder requires: $cmd"; return 1; }
  done
  docker info >/dev/null 2>&1 || { fail "Docker daemon is required on the connected supplement builder host."; return 1; }

  [[ -n "$base_input" ]] || read -r -p "Path to existing format-v2 Spark Air-Gap bundle: " base_input
  [[ -n "$base_input" ]] || { fail "Base Air-Gap bundle path is required."; return 1; }

  work="$(mktemp -d)"
  trap '[[ -z "${work:-}" ]] || rm -rf -- "$work"' EXIT
  base_stage="${work}/base"
  mkdir -p "$base_stage"
  base_root="$(airgap_target_patch_open_base "$base_input" "$base_stage")" || return 1
  airgap_validate_retarget_base_dir "$base_root" || return 1

  base_id="$(airgap_target_bundle_meta_from "$base_root" BUNDLE_ID)"
  base_commit="$(airgap_target_bundle_meta_from "$base_root" SPARK_COMMIT)"
  base_supabase_commit="$(airgap_target_bundle_meta_from "$base_root" SUPABASE_COMMIT)"
  [[ -n "$base_id" && "$base_commit" =~ ^[0-9a-f]{40}$ && "$base_supabase_commit" =~ ^[0-9a-f]{40}$ ]] || {
    fail "Base bundle identity is incomplete."
    return 1
  }

  source="${work}/spark-source"
  git clone --branch main "${base_root}/sources/spark.git.bundle" "$source" >/dev/null 2>&1 || return 1
  git -C "$source" checkout "$base_commit" >/dev/null 2>&1 || return 1
  supabase_source="${work}/supabase-source"
  supabase_branch="$(airgap_target_bundle_meta_from "$base_root" SUPABASE_BRANCH)"
  [[ -n "$supabase_branch" ]] || { fail "Base bundle Supabase branch is missing."; return 1; }
  git clone --branch "$supabase_branch" "${base_root}/sources/supabase.git.bundle" "$supabase_source" >/dev/null 2>&1 || return 1
  git -C "$supabase_source" checkout "$base_supabase_commit" >/dev/null 2>&1 || return 1

  created_at="$(date -u +%Y%m%dT%H%M%SZ)"
  pack_id="spark-edge-functions-supplement-${base_commit:0:12}-${created_at}"
  root="${work}/${pack_id}"
  mkdir -p "$root/metadata"
  _airgap_edge_build_payload "$root" "$source" "$supabase_source" || return 1

  edge_meta="${root}/metadata/edge-runtime.env"
  [[ "$(_airgap_edge_meta_from "$edge_meta" EDGE_RUNTIME_IMAGE_ID)" == \
     "$(_airgap_edge_meta_from "${base_root}/metadata/edge-runtime.env" EDGE_RUNTIME_IMAGE_ID)" ]] || {
    fail "Supplement runtime image differs from the base bundle; build a new full bundle instead."
    return 1
  }
  count="$(_airgap_edge_meta_from "$edge_meta" FUNCTION_COUNT)"
  cat >"${root}/metadata/manifest.env" <<EOF_EDGE_PACK
FORMAT_VERSION=${AIRGAP_EDGE_PACK_FORMAT_VERSION}
PACK_TYPE=SPARK_EDGE_FUNCTIONS_SUPPLEMENT
PAYLOAD_MODE=${AIRGAP_EDGE_CACHE_MODE}
PACK_ID=${pack_id}
CREATED_AT=${created_at}
ARCH=amd64
BASE_BUNDLE_ID=${base_id}
BASE_SPARK_COMMIT=${base_commit}
BASE_SUPABASE_COMMIT=${base_supabase_commit}
FUNCTION_COUNT=${count}
EDGE_RUNTIME_IMAGE=$(_airgap_edge_meta_from "$edge_meta" EDGE_RUNTIME_IMAGE)
TARGET_DENO_VERSION=$(_airgap_edge_meta_from "$edge_meta" TARGET_DENO_VERSION)
DENO_CACHE_FILES=$(_airgap_edge_meta_from "$edge_meta" DENO_CACHE_FILES)
EOF_EDGE_PACK
  _airgap_edge_write_json_manifest "${root}/metadata/manifest.env" "${root}/manifest.json" || return 1
  (cd "$root" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS) || return 1

  if [[ -z "$output" ]]; then
    output="/var/backups/spark-airgap/${pack_id}.tar.gz"
  elif [[ -d "$output" || "$output" == */ ]]; then
    mkdir -p "$output"
    output="${output%/}/${pack_id}.tar.gz"
  fi
  [[ "$output" == /* ]] || output="$(pwd)/$output"
  mkdir -p "$(dirname "$output")"
  tar -C "$work" -czf "$output" "$pack_id" || return 1
  (cd "$(dirname "$output")" && sha256sum "$(basename "$output")" >"$(basename "$output").sha256") || return 1

  ok "Edge Functions DENO_DIR supplement created: ${output}"
  printf 'Base Spark commit : %s\n' "$base_commit"
  printf 'Target Edge image : %s\n' "$(_airgap_edge_meta_from "$edge_meta" EDGE_RUNTIME_IMAGE)"
  printf 'Target Deno       : %s\n' "$(_airgap_edge_meta_from "$edge_meta" TARGET_DENO_VERSION)"
  printf 'Functions         : %s\n' "$count"
)

# Standalone bank-side maintenance path for a format-v2 supplement.
airgap_import_edge_functions_pack() {
  title
  new_log "airgap-import-edge-functions-pack-v2"
  local input="${1:-}" applier="${SPARK_ROOT}/deploy/spark-cli/apply-edge-functions-supplement.sh"
  [[ -n "$input" ]] || read -r -p "Path to Edge Functions supplement .tar.gz: " input
  [[ -n "$input" && -f "$input" ]] || { fail "Edge Functions supplement path is required."; return 1; }
  [[ -f "$applier" ]] || { fail "Standalone Edge Functions supplement applier is missing: ${applier}"; return 1; }
  run_visible "Apply Edge Functions DENO_DIR supplement" bash "$applier" "$input"
}
