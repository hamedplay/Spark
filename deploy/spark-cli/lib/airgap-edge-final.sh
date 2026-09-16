# Final hardening for Spark Air-Gap Edge Runtime format-v2 payloads.
# Loaded after airgap-edge-functions-runtime-fix.sh.
#
# Keep dependency caching as caching (never generated JS), prove that the exact
# target Deno supports the required cache semantics, and seed the real Docker
# named-volume mount while the functions worker is stopped.

_airgap_edge_cache_dependencies() {
  local source_dir="$1" cache_dir="$2" deno_image="$3"

  rm -rf "$cache_dir"
  mkdir -p "$cache_dir"

  info "Pre-warming Edge Function DENO_DIR with exact target ${deno_image}."
  docker pull --platform linux/amd64 "$deno_image" || return 1

  # Deno 2.1.x keeps `deno cache` as a hidden compatibility command. It exposes
  # --no-lock and --no-check, but does not expose --cached-only on that
  # subcommand. Requiring --cached-only here incorrectly rejects the exact Deno
  # embedded in Supabase Edge Runtime v1.76.2. The disconnected proof below is
  # still deterministic because Docker networking is disabled completely: if a
  # dependency is missing from DENO_DIR, `deno cache` must fail when it tries to
  # resolve it from the network.
  docker run --rm --platform linux/amd64 --entrypoint sh "$deno_image" -c '
set -eu
help="$(deno cache --help)"
printf "%s" "$help" | grep -q -- "--no-lock"
printf "%s" "$help" | grep -q -- "--no-check"
' || {
    fail "Exact target Deno does not support the required cache verification flags."
    return 1
  }

  # Connected pass. The source is mounted at the exact bank runtime path, and
  # DENO_DIR is the exact persistent path used by Supabase Edge Runtime.
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
  deno cache --config "$config" --no-check --no-lock "$entry"
  count=$((count + 1))
done
[ "$count" -gt 0 ]
printf "Cached dependency graphs for %s Edge Runtime entrypoints.\n" "$count"
' || {
    fail "Unable to pre-warm the exact-version Edge Function DENO_DIR."
    return 1
  }

  # Disconnected proof. No DNS/HTTP access exists in this container. Deno 2.1.x
  # does not offer --cached-only for `deno cache`, so --network none is the
  # authoritative guard: every JSR/npm/http dependency for every entrypoint must
  # already be satisfiable from the transferred DENO_DIR or the command fails.
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
  deno cache --config "$config" --no-check --no-lock "$entry"
  count=$((count + 1))
done
[ "$count" -gt 0 ]
printf "Offline dependency proof passed for %s Edge Runtime entrypoints with Docker networking disabled.\n" "$count"
' || {
    fail "Offline Edge Function dependency verification failed with Docker networking disabled."
    return 1
  }

  [[ -n "$(find "$cache_dir" -mindepth 1 -print -quit)" ]] || {
    fail "Deno dependency cache is empty after the connected cache pass."
    return 1
  }
}

_airgap_edge_seed_live_cache() {
  local root="$1" meta="${1}/metadata/edge-runtime.env"
  local expected_image expected_image_id expected_deno expected_cache_files
  local functions_mount expected_functions_mount cache_type cache_name cache_destination cache_mountpoint
  local actual_image actual_image_id actual_deno runtime actual_cache_files cache_diff

  expected_image="$(_airgap_edge_meta_from "$meta" EDGE_RUNTIME_IMAGE)"
  expected_image_id="$(_airgap_edge_meta_from "$meta" EDGE_RUNTIME_IMAGE_ID)"
  expected_deno="$(_airgap_edge_meta_from "$meta" TARGET_DENO_VERSION)"
  expected_cache_files="$(_airgap_edge_meta_from "$meta" DENO_CACHE_FILES)"

  # Resolve and canonicalize the live functions mount. Never infer the runtime
  # from /opt/supabase-source/docker or from the current working directory.
  functions_mount="$(docker inspect "$AIRGAP_EDGE_FUNCTIONS_CONTAINER" \
    --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
  [[ -n "$functions_mount" && -d "$functions_mount" ]] || {
    fail "Unable to resolve live /home/deno/functions mount from ${AIRGAP_EDGE_FUNCTIONS_CONTAINER}."
    return 1
  }
  functions_mount="$(readlink -f "$functions_mount")"
  expected_functions_mount="$(readlink -f "${SUPABASE_ROOT}/volumes/functions")"
  [[ "$functions_mount" == "$expected_functions_mount" ]] || {
    fail "Edge Runtime functions mount is ${functions_mount}; expected ${expected_functions_mount}."
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
    --format '{{range .Mounts}}{{if eq .Destination "/root/.cache/deno"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' 2>/dev/null || true)"
  cache_destination="$(docker inspect "$AIRGAP_EDGE_FUNCTIONS_CONTAINER" \
    --format '{{range .Mounts}}{{if eq .Destination "/root/.cache/deno"}}{{.Destination}}{{end}}{{end}}' 2>/dev/null || true)"
  [[ "$cache_type" == "volume" && "$cache_destination" == "/root/.cache/deno" && -n "$cache_name" ]] || {
    fail "Live Edge Runtime does not expose the expected persistent named DENO_DIR volume."
    return 1
  }

  cache_mountpoint="$(docker volume inspect "$cache_name" --format '{{.Mountpoint}}' 2>/dev/null || true)"
  [[ -n "$cache_mountpoint" && -d "$cache_mountpoint" ]] || {
    fail "Unable to resolve host mountpoint for DENO_DIR volume ${cache_name}."
    return 1
  }
  cache_mountpoint="$(readlink -f "$cache_mountpoint")"
  [[ "$cache_mountpoint" != "/" && "$cache_mountpoint" != "/var" && "$cache_mountpoint" != "/var/lib" ]] || {
    fail "Refusing unsafe DENO_DIR mountpoint: ${cache_mountpoint}."
    return 1
  }

  actual_image="$(docker inspect "$AIRGAP_EDGE_FUNCTIONS_CONTAINER" --format '{{.Config.Image}}' 2>/dev/null || true)"
  actual_image_id="$(docker inspect "$AIRGAP_EDGE_FUNCTIONS_CONTAINER" --format '{{.Image}}' 2>/dev/null || true)"
  actual_deno="$(docker exec "$AIRGAP_EDGE_FUNCTIONS_CONTAINER" edge-runtime --version 2>/dev/null \
    | awk '$1=="deno" {print $2; exit}')"
  [[ "$actual_image" == "$expected_image" && "$actual_image_id" == "$expected_image_id" ]] || {
    fail "Live Edge Runtime image differs from the image used to build DENO_DIR."
    return 1
  }
  [[ "$actual_deno" == "$expected_deno" ]] || {
    fail "Embedded Deno mismatch: bundle=${expected_deno}, live=${actual_deno:-unknown}."
    return 1
  }

  # Stop the worker before replacing the cache. Copy directly into Docker's
  # resolved volume mountpoint as root; this avoids assuming helper binaries are
  # present in the Edge Runtime image and makes activation deterministic.
  docker compose --env-file "${runtime}/.env" -f "${runtime}/docker-compose.yml" stop functions >>"$CURRENT_LOG" 2>&1 || return 1
  if ! rsync -a --delete "${root}/deno-cache/" "${cache_mountpoint}/" >>"$CURRENT_LOG" 2>&1; then
    fail "Unable to seed persistent Edge Runtime DENO_DIR volume ${cache_name}; functions remain stopped. Retry offline step 10."
    return 1
  fi

  # Deno can create cache/index files as soon as the worker starts. Verify the
  # transferred snapshot while it is still stopped, never a live mutable cache.
  actual_cache_files="$(find "$cache_mountpoint" -type f | wc -l | tr -d '[:space:]')"
  [[ "$actual_cache_files" == "$expected_cache_files" ]] || {
    fail "Seeded DENO_DIR file count mismatch before startup: expected=${expected_cache_files}, actual=${actual_cache_files:-unknown}. Functions remain stopped; retry offline step 10."
    return 1
  }
  # Count alone cannot detect corrupted or substituted files. Dry-run checksum
  # comparison also detects unexpected paths and changed symbolic-link targets.
  cache_diff="$(rsync -rlcni --delete "${root}/deno-cache/" "${cache_mountpoint}/" 2>>"$CURRENT_LOG")" || {
    fail "Unable to verify seeded DENO_DIR content; functions remain stopped. Retry offline step 10."
    return 1
  }
  if [[ -n "$cache_diff" ]]; then
    printf '%s\n' "$cache_diff" >>"$CURRENT_LOG"
    fail "Seeded DENO_DIR content differs from the verified bundle; functions remain stopped. Retry offline step 10."
    return 1
  fi
  # Startup may legitimately mutate DENO_DIR. The caller validates readiness
  # with the existing real HTTP worker cold-start probe after this returns.
  docker compose --env-file "${runtime}/.env" -f "${runtime}/docker-compose.yml" start functions >>"$CURRENT_LOG" 2>&1 || return 1
}
