#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

BACKUP_DIR="/var/backups/spark"
ACTIVE_LINK="/opt/spark-airgap/current"
FUNCTIONS_CONTAINER="supabase-edge-functions"
DB_CONTAINER="supabase-db"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  exec sudo -E "$0" "$@"
fi

input="${1:-}"
if [[ -z "$input" || ! -f "$input" ]]; then
  printf 'Usage: %s /path/to/spark-edge-functions-supplement-*.tar.gz\n' "$0" >&2
  exit 2
fi
input="$(readlink -f "$input")"

for cmd in tar sha256sum sed find rsync docker curl awk readlink; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Required command is missing: $cmd" >&2; exit 1; }
done

[[ -e "$ACTIVE_LINK" ]] || { echo "Active Spark Air-Gap bundle is missing: $ACTIVE_LINK" >&2; exit 1; }
active_root="$(readlink -f "$ACTIVE_LINK")"
active_manifest="${active_root}/metadata/manifest.env"
[[ -f "$active_manifest" ]] || { echo "Active Spark Air-Gap manifest is missing." >&2; exit 1; }
active_commit="$(sed -n 's/^SPARK_COMMIT=//p' "$active_manifest" | tail -n1)"
[[ "$active_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "Active Spark commit is invalid." >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

while IFS= read -r entry; do
  [[ -n "$entry" ]] || continue
  case "$entry" in
    /*|../*|*/../*|*'/..') echo "Unsafe path in supplement: $entry" >&2; exit 1 ;;
  esac
done < <(tar -tzf "$input")
if tar -tvzf "$input" | awk '$1 ~ /^[lh]/ {found=1} END{exit !found}'; then
  echo "Supplement contains symlink/hardlink entries; refused." >&2
  exit 1
fi

tar -xzf "$input" -C "$work"
root="$(find "$work" -mindepth 1 -maxdepth 1 -type d -name 'spark-edge-functions-supplement-*' | head -n1)"
[[ -n "$root" ]] || { echo "Edge Functions supplement root is missing." >&2; exit 1; }

for path in metadata/manifest.env manifest.json SHA256SUMS edge-functions/.spark-bundled-functions; do
  [[ -f "${root}/${path}" ]] || { echo "Supplement is missing: $path" >&2; exit 1; }
done
[[ -d "${root}/deno-cache" ]] || { echo "Supplement is missing the pre-warmed Deno cache." >&2; exit 1; }
(cd "$root" && sha256sum -c SHA256SUMS)

meta="${root}/metadata/manifest.env"
value() { sed -n "s/^$1=//p" "$meta" | tail -n1; }

[[ "$(value FORMAT_VERSION)" == "2" ]] || { echo "Unsupported supplement format; expected v2 DENO_DIR payload." >&2; exit 1; }
[[ "$(value PACK_TYPE)" == "SPARK_EDGE_FUNCTIONS_SUPPLEMENT" ]] || { echo "Invalid supplement type." >&2; exit 1; }
[[ "$(value PAYLOAD_MODE)" == "DENO_DIR" ]] || { echo "Unsupported supplement payload mode." >&2; exit 1; }
[[ "$(value ARCH)" == "amd64" ]] || { echo "Unsupported supplement architecture." >&2; exit 1; }

pack_commit="$(value BASE_SPARK_COMMIT)"
count="$(value FUNCTION_COUNT)"
expected_image="$(value EDGE_RUNTIME_IMAGE)"
expected_deno="$(value TARGET_DENO_VERSION)"
expected_cache_files="$(value DENO_CACHE_FILES)"

[[ "$pack_commit" == "$active_commit" ]] || {
  echo "Supplement Spark commit ${pack_commit:0:12} does not match active base ${active_commit:0:12}." >&2
  exit 1
}
[[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]] || { echo "Invalid function count." >&2; exit 1; }
[[ "$expected_deno" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid target Deno version in supplement." >&2; exit 1; }
[[ "$expected_cache_files" =~ ^[0-9]+$ && "$expected_cache_files" -gt 0 ]] || { echo "Invalid Deno cache inventory." >&2; exit 1; }
[[ "$(wc -l <"${root}/edge-functions/.spark-bundled-functions" | tr -d '[:space:]')" == "$count" ]] || {
  echo "Function inventory count mismatch." >&2
  exit 1
}
[[ "$(find "${root}/deno-cache" -type f | wc -l | tr -d '[:space:]')" == "$expected_cache_files" ]] || {
  echo "Deno cache file count mismatch after extraction." >&2
  exit 1
}

# Determine the actual runtime from the live container mount, not from a guessed
# filesystem path. This prevents applying to /opt/supabase-source/docker when
# the real Spark runtime is /opt/spark-supabase.
functions_mount="$(docker inspect "$FUNCTIONS_CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
[[ -n "$functions_mount" && -d "$functions_mount" ]] || {
  echo "Unable to resolve the live /home/deno/functions mount from ${FUNCTIONS_CONTAINER}." >&2
  exit 1
}
functions_mount="$(readlink -f "$functions_mount")"
runtime="$(dirname "$(dirname "$functions_mount")")"
functions_dir="${runtime}/volumes/functions"
[[ "$functions_mount" == "$functions_dir" ]] || {
  echo "Unexpected functions mount: ${functions_mount}; expected ${functions_dir}." >&2
  exit 1
}
[[ -f "${runtime}/docker-compose.yml" && -f "${runtime}/.env" ]] || {
  echo "Live Supabase runtime is incomplete: ${runtime}" >&2
  exit 1
}

cache_destination="$(docker inspect "$FUNCTIONS_CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/root/.cache/deno"}}{{.Destination}}{{end}}{{end}}' 2>/dev/null || true)"
cache_mount_name="$(docker inspect "$FUNCTIONS_CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/root/.cache/deno"}}{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' 2>/dev/null || true)"
[[ "$cache_destination" == "/root/.cache/deno" && -n "$cache_mount_name" ]] || {
  echo "The live Edge Runtime does not expose the expected persistent Deno cache mount." >&2
  exit 1
}

actual_image="$(docker inspect "$FUNCTIONS_CONTAINER" --format '{{.Config.Image}}' 2>/dev/null || true)"
[[ "$actual_image" == "$expected_image" ]] || {
  echo "Edge Runtime image mismatch: supplement=${expected_image}, live=${actual_image:-unknown}." >&2
  exit 1
}
actual_deno="$(docker exec "$FUNCTIONS_CONTAINER" edge-runtime --version 2>/dev/null | awk '$1=="deno" {print $2; exit}')"
[[ "$actual_deno" == "$expected_deno" ]] || {
  echo "Embedded Deno mismatch: supplement=${expected_deno}, live=${actual_deno:-unknown}." >&2
  exit 1
}

# Verify the database route used by password-login before changing anything.
# The Edge Runtime image includes bash (its official healthcheck uses /dev/tcp).
if ! docker exec "$FUNCTIONS_CONTAINER" bash -lc '
set -eu
url="${SUPABASE_DB_URL:-}"
[ -n "$url" ]
hostport="${url#*@}"
hostport="${hostport%%/*}"
host="${hostport%:*}"
port="${hostport##*:}"
[ -n "$host" ]
case "$port" in (*[!0-9]*|"") exit 2;; esac
timeout 5 bash -c "exec 3<>/dev/tcp/${host}/${port}"
' >/dev/null 2>&1; then
  echo "Edge Runtime cannot reach PostgreSQL through SUPABASE_DB_URL; supplement not applied." >&2
  exit 1
fi

# Validate the exact DB configuration password-login reads. This separates DB
# readiness from dependency/runtime readiness and avoids a misleading rollback.
if ! docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atqc \
  "select case when exists (select 1 from public.get_phone_auth_config()) then 'ok' else 'empty' end;" \
  | grep -Fxq ok; then
  echo "public.get_phone_auth_config() is missing/empty; supplement not applied." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%d-%H%M%S)"
backup="${BACKUP_DIR}/edge-functions-before-${stamp}.tar.gz"
failure_log="${BACKUP_DIR}/edge-functions-failed-${stamp}.log"
tar -C "$(dirname "$functions_dir")" -czf "$backup" "$(basename "$functions_dir")"

capture_failure_logs() {
  docker logs --since 10m "$FUNCTIONS_CONTAINER" >"$failure_log" 2>&1 || true
  echo "Failure diagnostics saved to: $failure_log" >&2
  tail -n 120 "$failure_log" >&2 || true
}

rollback() {
  echo "Rolling back previous Edge Functions sources..." >&2
  rm -rf "$functions_dir"
  tar -C "$(dirname "$functions_dir")" -xzf "$backup"
  docker compose --env-file "${runtime}/.env" -f "${runtime}/docker-compose.yml" restart functions >/dev/null 2>&1 || true
}

# Install original source, not generated bundles. Keep the Spark offline-safe
# main router already installed on the target.
rsync -a --delete --exclude=main "${root}/edge-functions/" "${functions_dir}/"

# Merge the pre-warmed exact-version DENO_DIR into the persistent cache volume.
# Deno's cache is content-addressed; existing unrelated entries are safe to keep.
docker cp "${root}/deno-cache/." "${FUNCTIONS_CONTAINER}:/root/.cache/deno/"

if ! docker compose --env-file "${runtime}/.env" -f "${runtime}/docker-compose.yml" restart functions; then
  capture_failure_logs
  rollback
  exit 1
fi
sleep 3

anon="$(sed -n 's/^ANON_KEY=//p' "${runtime}/.env" | tail -n1)"
[[ -n "$anon" ]] || {
  capture_failure_logs
  rollback
  echo "ANON_KEY is missing." >&2
  exit 1
}

probe="$(mktemp)"

# Probe 1: pure runtime/dependency cold start. OPTIONS returns before auth/DB
# logic in auth-health-check, so failure here means source/cache/runtime only.
runtime_code="$(curl --noproxy '*' -sS --connect-timeout 5 --max-time 15 \
  -o "$probe" -w '%{http_code}' \
  -X OPTIONS \
  -H "apikey: ${anon}" \
  -H "Authorization: Bearer ${anon}" \
  http://127.0.0.1:8000/functions/v1/auth-health-check || true)"
if [[ "$runtime_code" != "204" ]]; then
  echo "Offline dependency/runtime probe failed (expected HTTP 204, got ${runtime_code:-000})." >&2
  [[ -s "$probe" ]] && { echo "Probe body:" >&2; cat "$probe" >&2; echo >&2; }
  capture_failure_logs
  rollback
  rm -f "$probe"
  exit 1
fi

# Probe 2: actual password-login path. With no Origin, a healthy function first
# reads DB config then deterministically returns INVALID_REQUEST / HTTP 400.
: >"$probe"
login_code="$(curl --noproxy '*' -sS --connect-timeout 5 --max-time 20 \
  -o "$probe" -w '%{http_code}' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H "apikey: ${anon}" \
  -H "Authorization: Bearer ${anon}" \
  http://127.0.0.1:8000/functions/v1/password-login \
  -d '{"method":"username","identifier":"__spark_offline_probe__","password":"invalid"}' || true)"

if [[ "$login_code" != "400" ]] || ! grep -q 'INVALID_REQUEST' "$probe"; then
  echo "Edge dependencies are live, but password-login functional probe failed (expected HTTP 400 INVALID_REQUEST, got ${login_code:-000})." >&2
  [[ -s "$probe" ]] && { echo "Probe body:" >&2; cat "$probe" >&2; echo >&2; }
  capture_failure_logs
  rm -f "$probe"
  echo "The v2 source/cache payload remains installed because the offline runtime probe passed; no destructive rollback was performed." >&2
  exit 3
fi
rm -f "$probe"

printf 'Edge Functions supplement v2 applied successfully.\n'
printf 'Functions updated   : %s\n' "$count"
printf 'Runtime             : %s\n' "$runtime"
printf 'Edge Runtime image  : %s\n' "$actual_image"
printf 'Embedded Deno       : %s\n' "$actual_deno"
printf 'Deno cache mount    : %s\n' "$cache_mount_name"
printf 'Safety backup       : %s\n' "$backup"
printf 'Runtime probe HTTP  : %s\n' "$runtime_code"
printf 'Password probe HTTP : %s\n' "$login_code"
