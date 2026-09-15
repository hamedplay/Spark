# Runtime compatibility override for fully offline Edge Function payloads.
# Deno's bundle output is JavaScript. Writing that output back to index.ts makes
# Supabase Edge Runtime run it through its TypeScript compiler again, which can
# break CommonJS interop in bundled npm dependencies (for example tslib).
# Keep the generated bundle as .js and make index.ts a tiny local-only wrapper.

airgap_build_edge_functions_payload() {
  local output="$1" src="${2:-${SPARK_ROOT}/supabase/functions}" deno_image="$AIRGAP_EDGE_DENO_IMAGE"
  local count

  require_dir "$src" || return 1
  rm -rf "$output"
  mkdir -p "$output"
  cp -a "${src}/." "$output/" || return 1

  info "Preparing Deno ${deno_image} to resolve Edge Function JSR/npm dependencies."
  docker pull "$deno_image" || return 1

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
  sed -i "/functions-js.*edge-runtime\\.d\\.ts/d" "$entry"

  bundle="/out/${name}/spark-offline-bundle.js"
  deno bundle --platform=deno --no-check --no-lock -o "$bundle" "$entry"

  # Edge Runtime discovers index.ts. Keep that file TypeScript-trivial and load
  # the already-emitted JavaScript without asking Edge Runtime to transpile the
  # large vendor bundle as TypeScript again.
  printf "%s\n" "import \"./spark-offline-bundle.js\";" > "/out/${name}/index.ts"
  printf "%s\n" "$name" >> /out/.spark-bundled-functions
  count=$((count + 1))
done
[ "$count" -gt 0 ]
' || {
    fail "Unable to create the offline Edge Function dependency payload."
    return 1
  }

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
    bundle = root / name / "spark-offline-bundle.js"
    if not entry.is_file():
        bad.append(f"{name}: wrapper entrypoint is missing")
        continue
    if not bundle.is_file() or bundle.stat().st_size == 0:
        bad.append(f"{name}: JavaScript offline bundle is missing or empty")
        continue
    if entry.read_text(encoding="utf-8").strip() != 'import "./spark-offline-bundle.js";':
        bad.append(f"{name}: wrapper entrypoint is not the expected local-only import")
        continue
    text = bundle.read_text(encoding="utf-8")
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
