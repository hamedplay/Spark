#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

BACKUP_DIR="/var/backups/spark"
ACTIVE_LINK="/opt/spark-airgap/current"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  exec sudo -E "$0" "$@"
fi

input="${1:-}"
if [[ -z "$input" || ! -f "$input" ]]; then
  printf 'Usage: %s /path/to/spark-edge-functions-supplement-*.tar.gz\n' "$0" >&2
  exit 2
fi
input="$(readlink -f "$input")"

for cmd in tar sha256sum sed find rsync docker curl; do
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
(cd "$root" && sha256sum -c SHA256SUMS)

meta="${root}/metadata/manifest.env"
value() { sed -n "s/^$1=//p" "$meta" | tail -n1; }
[[ "$(value FORMAT_VERSION)" == "1" ]] || { echo "Unsupported supplement format." >&2; exit 1; }
[[ "$(value PACK_TYPE)" == "SPARK_EDGE_FUNCTIONS_SUPPLEMENT" ]] || { echo "Invalid supplement type." >&2; exit 1; }
[[ "$(value ARCH)" == "amd64" ]] || { echo "Unsupported supplement architecture." >&2; exit 1; }
pack_commit="$(value BASE_SPARK_COMMIT)"
count="$(value FUNCTION_COUNT)"
[[ "$pack_commit" == "$active_commit" ]] || {
  echo "Supplement Spark commit ${pack_commit:0:12} does not match active base ${active_commit:0:12}." >&2
  exit 1
}
[[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]] || { echo "Invalid function count." >&2; exit 1; }
[[ "$(wc -l <"${root}/edge-functions/.spark-bundled-functions" | tr -d '[:space:]')" == "$count" ]] || {
  echo "Function inventory count mismatch." >&2
  exit 1
}

runtime=""
for candidate in /opt/spark-supabase /opt/supabase-source/docker; do
  if [[ -f "${candidate}/docker-compose.yml" && -f "${candidate}/.env" && -d "${candidate}/volumes/functions" ]]; then
    runtime="$candidate"
    break
  fi
done
[[ -n "$runtime" ]] || { echo "Unable to locate active Supabase runtime." >&2; exit 1; }
functions_dir="${runtime}/volumes/functions"

mkdir -p "$BACKUP_DIR"
backup="${BACKUP_DIR}/edge-functions-before-$(date -u +%Y%m%d-%H%M%S).tar.gz"
tar -C "$(dirname "$functions_dir")" -czf "$backup" "$(basename "$functions_dir")"

rollback() {
  echo "Rolling back previous Edge Functions runtime..." >&2
  rm -rf "$functions_dir"
  tar -C "$(dirname "$functions_dir")" -xzf "$backup"
  docker compose --env-file "${runtime}/.env" -f "${runtime}/docker-compose.yml" restart functions >/dev/null 2>&1 || true
}

rsync -a --delete --exclude=main "${root}/edge-functions/" "${functions_dir}/"
if ! docker compose --env-file "${runtime}/.env" -f "${runtime}/docker-compose.yml" restart functions; then
  rollback
  exit 1
fi
sleep 3

anon="$(sed -n 's/^ANON_KEY=//p' "${runtime}/.env" | tail -n1)"
[[ -n "$anon" ]] || { rollback; echo "ANON_KEY is missing." >&2; exit 1; }
probe="$(mktemp)"
code="$(curl --noproxy '*' -sS --connect-timeout 5 --max-time 25 \
  -o "$probe" -w '%{http_code}' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H "apikey: ${anon}" \
  -H "Authorization: Bearer ${anon}" \
  http://127.0.0.1:8000/functions/v1/password-login \
  -d '{"method":"username","identifier":"__spark_offline_probe__","password":"invalid"}' || true)"
rm -f "$probe"
case "$code" in
  2??|3??|4??) ;;
  *)
    rollback
    echo "Edge Function cold-start validation failed (HTTP ${code:-000})." >&2
    exit 1
    ;;
esac

printf 'Edge Functions supplement applied successfully.\n'
printf 'Functions updated: %s\n' "$count"
printf 'Runtime          : %s\n' "$runtime"
printf 'Safety backup    : %s\n' "$backup"
printf 'Cold-start HTTP  : %s\n' "$code"
