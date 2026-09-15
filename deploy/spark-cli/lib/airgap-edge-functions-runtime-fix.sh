# Edge Functions Air-Gap supplement v2.
#
# Do not rewrite Deno/npm/JSR graphs into one generated JavaScript bundle.
# Supabase Edge Runtime already mounts a persistent DENO_DIR at
# /root/.cache/deno. The reliable offline model is therefore:
#   1) keep the original function sources unchanged;
#   2) detect the exact Edge Runtime image embedded in the reusable base bundle;
#   3) read that image's embedded Deno version;
#   4) pre-warm a DENO_DIR with that exact Deno version on the connected builder;
#   5) prove the full function graph resolves with --network none + --cached-only;
#   6) ship sources + cache together in the small supplement.
#
# This avoids bundle/transpile interop drift (for example tslib default export
# mismatches) and prevents a newer builder Deno from producing output for an
# older target Edge Runtime.

AIRGAP_EDGE_PACK_FORMAT_VERSION="2"
AIRGAP_EDGE_CACHE_MODE="DENO_DIR"

_airgap_edge_meta_json() {
  local root="$1"
  EDGE_ROOT="$root" python3 - <<'PY'
import json, os
from pathlib import Path
root = Path(os.environ['EDGE_ROOT'])
values = {}
for line in (root / 'metadata/manifest.env').read_text(encoding='utf-8').splitlines():
    if '=' in line:
        k, v = line.split('=', 1)
        values[k] = v
(root / 'manifest.json').write_text(json.dumps(values, indent=2, sort_keys=True) + "\n", encoding='utf-8')
PY
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

_airgap_edge_cache_dependencies() {
  local source_dir="$1" cache_dir="$2" deno_image="$3"

  rm -rf "$cache_dir"
  mkdir -p "$cache_dir"

  info "Pre-warming Edge Function Deno cache with ${deno_image}."
  docker pull "$deno_image" || return 1

  # Connected pass: resolve every direct Edge Function graph into the same
  # DENO_DIR path used by the self-hosted Edge Runtime volume.
  docker run --rm --platform linux/amd64 \
    -e DENO_DIR=/root/.cache/deno \
    -v "${source_dir}:/home/deno/functions:ro" \
    -v "${cache_dir}:/root/.cache/deno" \
    --entrypoint sh "$deno_image" -c '
set -eu
count=0
for entry in /home/deno/functions/*/index.ts; do
  [ -f "$entry" ] || continue
  deno cache --no-check --no-lock "$entry"
  count=$((count + 1))
done
[ "$count" -gt 0 ]
printf "Cached dependency graphs for %s Edge Functions.\n" "$count"
' || {
    fail "Unable to pre-warm the Edge Function Deno cache."
    return 1
  }

  # Disconnected proof: resolve the same complete graph with networking removed.
  # If even one JSR/npm/http dependency is missing, --cached-only must fail.
  docker run --rm --platform linux/amd64 --network none \
    -e DENO_DIR=/root/.cache/deno \
    -v "${source_dir}:/home/deno/functions:ro" \
    -v "${cache_dir}:/root/.cache/deno" \
    --entrypoint sh "$deno_image" -c '
set -eu
count=0
for entry in /home/deno/functions/*/index.ts; do
  [ -f "$entry" ] || continue
  deno cache --cached-only --no-check --no-lock "$entry"
  count=$((count + 1))
done
[ "$count" -gt 0 ]
printf "Offline cached-only dependency proof passed for %s Edge Functions.\n" "$count"
' || {
    fail "Offline cached-only Edge Function dependency verification failed."
    return 1
  }

  [[ -n "$(find "$cache_dir" -mindepth 1 -print -quit)" ]] || {
    fail "Deno dependency cache is empty after a successful cache pass."
    return 1
  }
}

airgap_build_edge_functions_pack() {
  title
  new_log "airgap-build-edge-functions-pack-v2"

  local base_input="${1:-}" output="${2:-}" work base_stage base_root
  local base_id base_commit base_supabase_commit source supabase_source
  local runtime_image target_deno deno_image actual_deno
  local root pack_id created_at count cache_files cache_bytes

  for cmd in docker git tar gzip sha256sum python3 awk find; do
    command -v "$cmd" >/dev/null 2>&1 || {
      fail "Edge Functions supplement builder requires: $cmd"
      return 1
    }
  done
  docker info >/dev/null 2>&1 || {
    fail "Docker daemon is required on the connected supplement builder host."
    return 1
  }

  [[ -n "$base_input" ]] || read -r -p "Path to the existing large Spark Air-Gap bundle (.tar.gz or directory): " base_input
  [[ -n "$base_input" ]] || {
    fail "Base Air-Gap bundle path is required."
    return 1
  }

  work="$(mktemp -d)"
  trap '[[ -n "${work:-}" ]] && rm -rf -- "$work"' RETURN
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
  [[ -f "${base_root}/sources/spark.git.bundle" && -f "${base_root}/sources/supabase.git.bundle" ]] || {
    fail "Base bundle source snapshots are incomplete."
    return 1
  }

  source="${work}/spark-source"
  git clone --branch main "${base_root}/sources/spark.git.bundle" "$source" >/dev/null 2>&1 || return 1
  git -C "$source" checkout "$base_commit" >/dev/null 2>&1 || return 1

  supabase_source="${work}/supabase-source"
  git clone --branch master "${base_root}/sources/supabase.git.bundle" "$supabase_source" >/dev/null 2>&1 || return 1
  git -C "$supabase_source" checkout "$base_supabase_commit" >/dev/null 2>&1 || return 1

  runtime_image="$(_airgap_edge_runtime_image_from_compose "${supabase_source}/docker/docker-compose.yml")"
  [[ -n "$runtime_image" ]] || {
    fail "Unable to resolve the target Supabase Edge Runtime image from the base bundle."
    return 1
  }

  info "Target Edge Runtime image: ${runtime_image}"
  docker pull "$runtime_image" || return 1
  target_deno="$(docker run --rm --platform linux/amd64 --entrypoint edge-runtime "$runtime_image" --version 2>/dev/null \
    | awk '$1=="deno" {print $2; exit}')"
  [[ "$target_deno" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    fail "Unable to determine the embedded Deno version from ${runtime_image}."
    return 1
  }

  deno_image="denoland/deno:${target_deno}"
  docker pull "$deno_image" || return 1
  actual_deno="$(docker run --rm --platform linux/amd64 --entrypoint deno "$deno_image" --version 2>/dev/null \
    | awk '$1=="deno" {print $2; exit}')"
  [[ "$actual_deno" == "$target_deno" ]] || {
    fail "Deno builder/runtime mismatch: builder=${actual_deno:-unknown}, target=${target_deno}."
    return 1
  }

  created_at="$(date -u +%Y%m%dT%H%M%SZ)"
  pack_id="spark-edge-functions-supplement-${base_commit:0:12}-${created_at}"
  root="${work}/${pack_id}"
  mkdir -p "$root/metadata" "$root/edge-functions"

  # Keep application source byte-for-byte compatible with the base bundle.
  cp -a "${source}/supabase/functions/." "$root/edge-functions/" || return 1
  : >"${root}/edge-functions/.spark-bundled-functions"
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    basename "$(dirname "$entry")"
  done < <(find "${root}/edge-functions" -mindepth 2 -maxdepth 2 -type f -name index.ts | sort) \
    >"${root}/edge-functions/.spark-bundled-functions"

  count="$(wc -l <"${root}/edge-functions/.spark-bundled-functions" | tr -d '[:space:]')"
  [[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]] || {
    fail "Edge Function source inventory is empty."
    return 1
  }

  run_visible "Pre-warm exact target Deno dependency cache" \
    _airgap_edge_cache_dependencies "${root}/edge-functions" "${root}/deno-cache" "$deno_image" || return 1

  cache_files="$(find "${root}/deno-cache" -type f | wc -l | tr -d '[:space:]')"
  cache_bytes="$(du -sb "${root}/deno-cache" | awk '{print $1}')"
  [[ "$cache_files" =~ ^[0-9]+$ && "$cache_files" -gt 0 ]] || {
    fail "Deno dependency cache contains no files."
    return 1
  }

  cat >"${root}/metadata/manifest.env" <<EOF_EDGE_META
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
EDGE_RUNTIME_IMAGE=${runtime_image}
TARGET_DENO_VERSION=${target_deno}
DENO_IMAGE=${deno_image}
DENO_CACHE_FILES=${cache_files}
DENO_CACHE_BYTES=${cache_bytes}
EOF_EDGE_META

  _airgap_edge_meta_json "$root" || return 1
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
  printf 'Target Edge image : %s\n' "$runtime_image"
  printf 'Target Deno       : %s\n' "$target_deno"
  printf 'Functions         : %s\n' "$count"
  printf 'Cache files       : %s\n' "$cache_files"
}

# Keep one implementation of bank-side apply/diagnostics. The standalone
# applier is intentionally usable even when the installed Manager is older.
airgap_import_edge_functions_pack() {
  title
  new_log "airgap-import-edge-functions-pack-v2"
  local input="${1:-}" applier="${SPARK_ROOT}/deploy/spark-cli/apply-edge-functions-supplement.sh"

  [[ -n "$input" ]] || read -r -p "Path to Edge Functions supplement .tar.gz: " input
  [[ -n "$input" && -f "$input" ]] || {
    fail "Edge Functions supplement path is required."
    return 1
  }
  [[ -f "$applier" ]] || {
    fail "Standalone Edge Functions supplement applier is missing: ${applier}"
    return 1
  }
  run_visible "Apply Edge Functions DENO_DIR supplement" bash "$applier" "$input"
}
