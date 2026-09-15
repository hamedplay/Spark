# Fully offline Edge Function dependency payload for Spark Air-Gap.
# Loaded after the standard Air-Gap builder/runtime overrides.

AIRGAP_EDGE_DENO_IMAGE="${AIRGAP_EDGE_DENO_IMAGE:-denoland/deno:2.9.6}"

# Keep the existing frontend/npm payload builder, then augment the same bundle
# with self-contained Edge Function entrypoints. This avoids changing the
# established bundle format or the online installation path.
eval "$(declare -f airgap_build_npm_payload | sed '1s/airgap_build_npm_payload/airgap_build_npm_payload_base/')"
eval "$(declare -f install_step_7 | sed '1s/install_step_7/install_step_7_online/')"

airgap_build_edge_functions_payload() {
  local output="$1" src="${SPARK_ROOT}/supabase/functions" deno_image="$AIRGAP_EDGE_DENO_IMAGE"
  local count

  require_dir "$src" || return 1
  rm -rf "$output"
  mkdir -p "$output"
  cp -a "${src}/." "$output/" || return 1

  info "Preparing Deno ${deno_image} to resolve Edge Function JSR/npm dependencies."
  docker pull "$deno_image" || return 1

  # Resolve every dependency while the builder is connected. Work from a
  # private copy so type-only Edge Runtime declarations can be removed without
  # modifying the Spark repository. Each deployed index.ts becomes a single
  # self-contained module while non-code assets remain beside it.
  docker run --rm --platform linux/amd64 \
    -v "${src}:/src:ro" \
    -v "${output}:/out" \
    --entrypoint sh "$deno_image" -c '
set -eu
rm -rf /work/functions
mkdir -p /work/functions
cp -a /src/. /work/functions/
: > /out/.spark-bundled-functions
count=0
for entry in /work/functions/*/index.ts; do
  [ -f "$entry" ] || continue
  name="$(basename "$(dirname "$entry")")"
  # edge-runtime.d.ts is compile-time typing only; keeping it as a side-effect
  # JSR import would force the disconnected runtime to resolve jsr.io.
  sed -i "/functions-js.*edge-runtime\\.d\\.ts/d" "$entry"
  tmp="/out/${name}/index.ts.spark-bundle"
  deno bundle --platform=deno --no-check --no-lock -o "$tmp" "$entry"
  mv "$tmp" "/out/${name}/index.ts"
  printf "%s\\n" "$name" >> /out/.spark-bundled-functions
  count=$((count + 1))
done
[ "$count" -gt 0 ]
' || {
    fail "Unable to create the offline Edge Function dependency payload."
    return 1
  }

  # Prove the generated entrypoints can build a dependency graph with an empty
  # Deno cache and no network. Any remaining jsr:/npm:/http import fails here on
  # the connected builder instead of later on the bank server.
  docker run --rm --network none --platform linux/amd64 \
    -v "${output}:/functions:ro" \
    --entrypoint sh "$deno_image" -c '
set -eu
export DENO_DIR=/tmp/deno-empty
mkdir -p "$DENO_DIR"
while IFS= read -r name; do
  [ -n "$name" ] || continue
  deno check --no-config --no-lock --no-remote --no-npm "/functions/${name}/index.ts" >/dev/null
done < /functions/.spark-bundled-functions
' || {
    fail "Offline Edge Function verification found an unresolved external dependency."
    return 1
  }

  count="$(wc -l <"${output}/.spark-bundled-functions" | tr -d '[:space:]')"
  [[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]] || {
    fail "Offline Edge Function payload contains no bundled functions."
    return 1
  }
  info "Offline Edge Function payload contains ${count} self-contained functions."
}

airgap_build_npm_payload() {
  local output="$1"
  airgap_build_npm_payload_base "$@" || return 1
  airgap_build_edge_functions_payload "$(dirname "$output")/edge-functions"
}

airgap_test_bundled_function_sync() {
  local root="$1"
  diff -qr --exclude=main "${root}/edge-functions" "${SUPABASE_ROOT}/volumes/functions" || return 1
  diff -qr "${SUPABASE_SOURCE}/docker/volumes/functions/main" "${SUPABASE_ROOT}/volumes/functions/main" || return 1
}

install_step_7() {
  airgap_is_active || { install_step_7_online; return; }
  title
  new_log "install-07-functions-airgap"
  local root payload count

  root="$(airgap_current_root)" || { fail "No active air-gap bundle."; return 1; }
  payload="${root}/edge-functions"
  require_dir "$payload" || return 1
  airgap_require_file "${payload}/.spark-bundled-functions" || return 1
  require_dir "${SUPABASE_SOURCE}/docker/volumes/functions/main" || return 1

  count="$(wc -l <"${payload}/.spark-bundled-functions" | tr -d '[:space:]')"
  [[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]] || {
    fail "Bundled Edge Function inventory is empty. Rebuild the Air-Gap bundle on the connected builder."
    return 1
  }

  mkdir -p "${SUPABASE_ROOT}/volumes/functions"
  run_logged "Install pre-bundled offline Edge Functions" \
    rsync -a --delete "${payload}/" "${SUPABASE_ROOT}/volumes/functions/" || return 1
  rm -rf "${SUPABASE_ROOT}/volumes/functions/main"
  run_logged "Restore official Main Router from Supabase official" \
    cp -a "${SUPABASE_SOURCE}/docker/volumes/functions/main" "${SUPABASE_ROOT}/volumes/functions/main" || return 1

  if run_logged "Verify offline Edge Function payload sync" airgap_test_bundled_function_sync "$root"; then
    mark_step 7
    ok "${count} Edge Functions installed with JSR/npm dependencies bundled for offline execution."
  else
    unmark_step 7
    return 1
  fi
}
