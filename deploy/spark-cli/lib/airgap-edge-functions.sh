# Fully offline Edge Function dependency payload for Spark Air-Gap.
# Loaded after the standard Air-Gap builder/runtime overrides.

AIRGAP_EDGE_DENO_IMAGE="${AIRGAP_EDGE_DENO_IMAGE:-denoland/deno:2.9.6}"
AIRGAP_EDGE_PACK_FORMAT_VERSION="1"

# Keep the existing frontend/npm payload builder, then augment complete bundles
# with self-contained Edge Function entrypoints. Target patches intentionally
# skip this payload because Edge Functions now have their own small supplement.
eval "$(declare -f airgap_build_npm_payload | sed '1s/airgap_build_npm_payload/airgap_build_npm_payload_base/')"
eval "$(declare -f install_step_7 | sed '1s/install_step_7/install_step_7_online/')"

airgap_build_edge_functions_payload() {
  local output="$1" src="${2:-${SPARK_ROOT}/supabase/functions}" deno_image="$AIRGAP_EDGE_DENO_IMAGE"
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
  printf "%s\n" "$name" >> /out/.spark-bundled-functions
  count=$((count + 1))
done
[ "$count" -gt 0 ]
' || {
    fail "Unable to create the offline Edge Function dependency payload."
    return 1
  }

  # deno bundle already resolved the complete import graph while the builder
  # had network access. Do not run `deno check` on the generated bundle here:
  # the emitted third-party JavaScript intentionally contains erased TypeScript
  # class-field/type information and re-typechecking it can produce thousands
  # of false TS2339/TS7006 errors even though the bundle is valid executable JS.
  # Instead, prove that no unresolved remote import/export/dynamic-import
  # specifier survived into any generated entrypoint. This is the property the
  # disconnected Edge Runtime actually requires.
  EDGE_OUTPUT="$output" python3 - <<'PY'
import os
import re
import sys
from pathlib import Path

root = Path(os.environ["EDGE_OUTPUT"])
manifest = root / ".spark-bundled-functions"
if not manifest.is_file():
    print("offline Edge Function inventory is missing", file=sys.stderr)
    raise SystemExit(1)

static_remote = re.compile(
    r"(?m)^\s*(?:import|export)\s+(?:[^\"']*?\s+from\s+)?[\"'](?:https?://|jsr:|npm:)"
)
dynamic_remote = re.compile(
    r"import\s*\(\s*[\"'](?:https?://|jsr:|npm:)"
)

bad = []
for raw_name in manifest.read_text(encoding="utf-8").splitlines():
    name = raw_name.strip()
    if not name:
        continue
    entry = root / name / "index.ts"
    if not entry.is_file():
        bad.append(f"{name}: bundled entrypoint is missing")
        continue
    text = entry.read_text(encoding="utf-8")
    if static_remote.search(text) or dynamic_remote.search(text):
        bad.append(f"{name}: unresolved remote module specifier remains")

if bad:
    print("Offline Edge Function verification failed:", file=sys.stderr)
    for item in bad:
        print(f"  - {item}", file=sys.stderr)
    raise SystemExit(1)
PY
  if (( $? != 0 )); then
    fail "Offline Edge Function verification found an unresolved external dependency."
    return 1
  fi

  count="$(wc -l <"${output}/.spark-bundled-functions" | tr -d '[:space:]')"
  [[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]] || {
    fail "Offline Edge Function payload contains no bundled functions."
    return 1
  }
  info "Offline Edge Function payload contains ${count} self-contained functions."
}

airgap_build_npm_payload() {
  local output="$1" parent
  airgap_build_npm_payload_base "$@" || return 1
  parent="$(basename "$(dirname "$output")")"
  if [[ "$parent" == spark-airgap-target-patch-* ]]; then
    info "Skipping Edge Function payload in Ubuntu target patch; use the dedicated Edge Functions supplement instead."
    return 0
  fi
  airgap_build_edge_functions_payload "$(dirname "$output")/edge-functions"
}

airgap_test_bundled_function_sync() {
  local root="$1"
  diff -qr --exclude=main "${root}/edge-functions" "${SUPABASE_ROOT}/volumes/functions" || return 1
  diff -qr "${SUPABASE_SOURCE}/docker/volumes/functions/main" "${SUPABASE_ROOT}/volumes/functions/main" || return 1
}

airgap_edge_pack_meta_from() {
  local root="$1" key="$2" file="${root}/metadata/manifest.env"
  [[ -f "$file" ]] || return 1
  sed -n "s/^${key}=//p" "$file" | tail -n1
}

airgap_edge_runtime_root() {
  if [[ -f "${SUPABASE_ROOT}/docker-compose.yml" && -d "${SUPABASE_ROOT}/volumes/functions" ]]; then
    printf '%s\n' "$SUPABASE_ROOT"
    return 0
  fi
  if [[ -f "${SUPABASE_SOURCE}/docker/docker-compose.yml" && -d "${SUPABASE_SOURCE}/docker/volumes/functions" ]]; then
    printf '%s\n' "${SUPABASE_SOURCE}/docker"
    return 0
  fi
  return 1
}

airgap_edge_restart_functions() {
  local runtime="$1"
  "$AIRGAP_REAL_DOCKER" compose --env-file "${runtime}/.env" -f "${runtime}/docker-compose.yml" restart functions
}

airgap_edge_function_runtime_probe() {
  local runtime="$1" anon code
  anon="$(env_get "${runtime}/.env" ANON_KEY)"
  [[ -n "$anon" ]] || { fail "ANON_KEY is missing from the active Supabase runtime."; return 1; }
  code="$(curl --noproxy '*' -sS --connect-timeout 5 --max-time 25 \
    -o /tmp/spark-edge-functions-probe.$$ -w '%{http_code}' \
    -X POST \
    -H 'Content-Type: application/json' \
    -H "apikey: ${anon}" \
    -H "Authorization: Bearer ${anon}" \
    http://127.0.0.1:8000/functions/v1/password-login \
    -d '{"method":"username","identifier":"__spark_offline_probe__","password":"invalid"}' || true)"
  rm -f /tmp/spark-edge-functions-probe.$$ 2>/dev/null || true
  case "$code" in
    2??|3??|4??) return 0 ;;
    *)
      fail "Edge Function cold-start probe failed after supplement import (HTTP ${code:-000})."
      return 1
      ;;
  esac
}

airgap_build_edge_functions_pack() {
  title
  new_log "airgap-build-edge-functions-pack"
  local base_input="${1:-}" output="${2:-}" work base_stage base_root base_id base_commit source
  local root pack_id created_at count

  for cmd in docker git tar gzip sha256sum python3; do
    command -v "$cmd" >/dev/null 2>&1 || { fail "Edge Functions supplement builder requires: $cmd"; return 1; }
  done
  docker info >/dev/null 2>&1 || { fail "Docker daemon is required on the connected supplement builder host."; return 1; }

  [[ -n "$base_input" ]] || read -r -p "Path to the existing large Spark Air-Gap bundle (.tar.gz or directory): " base_input
  [[ -n "$base_input" ]] || { fail "Base Air-Gap bundle path is required."; return 1; }

  work="$(mktemp -d)"
  trap '[[ -n "${work:-}" ]] && rm -rf -- "$work"' RETURN
  base_stage="${work}/base"
  mkdir -p "$base_stage"
  base_root="$(airgap_target_patch_open_base "$base_input" "$base_stage")" || return 1
  airgap_validate_retarget_base_dir "$base_root" || return 1

  base_id="$(airgap_target_bundle_meta_from "$base_root" BUNDLE_ID)"
  base_commit="$(airgap_target_bundle_meta_from "$base_root" SPARK_COMMIT)"
  [[ -n "$base_id" && "$base_commit" =~ ^[0-9a-f]{40}$ ]] || {
    fail "Base bundle identity is incomplete."
    return 1
  }

  source="${work}/spark-source"
  git clone --branch main "${base_root}/sources/spark.git.bundle" "$source" >/dev/null 2>&1 || return 1
  git -C "$source" checkout "$base_commit" >/dev/null 2>&1 || return 1

  created_at="$(date -u +%Y%m%dT%H%M%SZ)"
  pack_id="spark-edge-functions-supplement-${base_commit:0:12}-${created_at}"
  root="${work}/${pack_id}"
  mkdir -p "$root/metadata"
  run_visible "Bundle Edge Function JSR/npm dependencies for offline runtime" \
    airgap_build_edge_functions_payload "${root}/edge-functions" "${source}/supabase/functions" || return 1

  count="$(wc -l <"${root}/edge-functions/.spark-bundled-functions" | tr -d '[:space:]')"
  cat >"${root}/metadata/manifest.env" <<EOF_EDGE_META
FORMAT_VERSION=${AIRGAP_EDGE_PACK_FORMAT_VERSION}
PACK_TYPE=SPARK_EDGE_FUNCTIONS_SUPPLEMENT
PACK_ID=${pack_id}
CREATED_AT=${created_at}
ARCH=amd64
BASE_BUNDLE_ID=${base_id}
BASE_SPARK_COMMIT=${base_commit}
FUNCTION_COUNT=${count}
DENO_IMAGE=${AIRGAP_EDGE_DENO_IMAGE}
EOF_EDGE_META

  EDGE_ROOT="$root" python3 - <<'PY'
import json, os
from pathlib import Path
root=Path(os.environ['EDGE_ROOT'])
values={}
for line in (root/'metadata/manifest.env').read_text().splitlines():
    if '=' in line:
        k,v=line.split('=',1); values[k]=v
(root/'manifest.json').write_text(json.dumps(values, indent=2, sort_keys=True)+"\n", encoding='utf-8')
PY
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
  (cd "$(dirname "$output")" && sha256sum "$(basename "$output")" >"$(basename "$output").sha256")
  ok "Edge Functions supplement created: ${output}"
  printf 'Base Spark commit: %s\nFunctions        : %s\n' "$base_commit" "$count"
}

airgap_import_edge_functions_pack() {
  title
  new_log "airgap-import-edge-functions-pack"
  local input="${1:-}" work root type format arch pack_commit active_root active_commit count runtime functions_dir
  local backup code

  [[ -n "$input" ]] || read -r -p "Path to Edge Functions supplement .tar.gz: " input
  [[ -n "$input" && -f "$input" ]] || { fail "Edge Functions supplement path is required."; return 1; }
  input="$(readlink -f "$input")"
  airgap_archive_safe_paths "$input" || return 1

  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN
  tar -xzf "$input" -C "$work" || return 1
  root="$(find "$work" -mindepth 1 -maxdepth 1 -type d -name 'spark-edge-functions-supplement-*' | head -n1)"
  [[ -n "$root" ]] || { fail "Edge Functions supplement root is missing."; return 1; }
  for path in metadata/manifest.env manifest.json SHA256SUMS edge-functions/.spark-bundled-functions; do
    [[ -f "${root}/${path}" ]] || { fail "Edge Functions supplement is missing: ${path}"; return 1; }
  done
  (cd "$root" && sha256sum -c SHA256SUMS) >>"$CURRENT_LOG" 2>&1 || {
    fail "Edge Functions supplement checksum validation failed."
    return 1
  }

  format="$(airgap_edge_pack_meta_from "$root" FORMAT_VERSION)"
  type="$(airgap_edge_pack_meta_from "$root" PACK_TYPE)"
  arch="$(airgap_edge_pack_meta_from "$root" ARCH)"
  pack_commit="$(airgap_edge_pack_meta_from "$root" BASE_SPARK_COMMIT)"
  count="$(airgap_edge_pack_meta_from "$root" FUNCTION_COUNT)"
  [[ "$format" == "$AIRGAP_EDGE_PACK_FORMAT_VERSION" && "$type" == "SPARK_EDGE_FUNCTIONS_SUPPLEMENT" && "$arch" == "amd64" ]] || {
    fail "Unsupported Edge Functions supplement metadata."
    return 1
  }
  [[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]] || { fail "Invalid Edge Functions supplement function count."; return 1; }
  [[ "$(wc -l <"${root}/edge-functions/.spark-bundled-functions" | tr -d '[:space:]')" == "$count" ]] || {
    fail "Edge Functions supplement inventory count mismatch."
    return 1
  }

  active_root="$(airgap_current_root)" || { fail "No active Air-Gap base bundle is installed."; return 1; }
  active_commit="$(airgap_meta_from "$active_root" SPARK_COMMIT)"
  [[ "$pack_commit" == "$active_commit" ]] || {
    fail "Edge Functions supplement belongs to Spark ${pack_commit:0:12}; active base is ${active_commit:0:12}."
    return 1
  }

  runtime="$(airgap_edge_runtime_root)" || { fail "Unable to locate the active Supabase runtime."; return 1; }
  functions_dir="${runtime}/volumes/functions"
  [[ -d "$functions_dir" && -f "${runtime}/.env" ]] || { fail "Active Supabase functions runtime is incomplete: ${runtime}"; return 1; }

  mkdir -p "$BACKUP_DIR"
  backup="${BACKUP_DIR}/edge-functions-before-$(date -u +%Y%m%d-%H%M%S).tar.gz"
  tar -C "$(dirname "$functions_dir")" -czf "$backup" "$(basename "$functions_dir")" || {
    fail "Unable to create Edge Functions safety backup."
    return 1
  }

  if ! rsync -a --delete --exclude=main "${root}/edge-functions/" "${functions_dir}/"; then
    fail "Unable to install Edge Functions supplement."
    return 1
  fi
  if ! airgap_edge_restart_functions "$runtime" >>"$CURRENT_LOG" 2>&1; then
    warn "Functions restart failed; rolling back the previous runtime."
    rm -rf "$functions_dir"
    tar -C "$(dirname "$functions_dir")" -xzf "$backup"
    airgap_edge_restart_functions "$runtime" >>"$CURRENT_LOG" 2>&1 || true
    return 1
  fi

  sleep 3
  if ! airgap_edge_function_runtime_probe "$runtime"; then
    warn "Offline cold-start validation failed; rolling back the previous Edge Functions runtime."
    rm -rf "$functions_dir"
    tar -C "$(dirname "$functions_dir")" -xzf "$backup"
    airgap_edge_restart_functions "$runtime" >>"$CURRENT_LOG" 2>&1 || true
    return 1
  fi

  ok "Edge Functions supplement imported and offline cold-start validated."
  printf 'Functions updated: %s\nSafety backup   : %s\nRuntime         : %s\n' "$count" "$backup" "$runtime"
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
