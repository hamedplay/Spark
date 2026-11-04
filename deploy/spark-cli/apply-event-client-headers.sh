#!/usr/bin/env bash
# Preserve routing/TLS; overwrite spoofable IP headers at Spark's Nginx ingress.
set -Eeuo pipefail
mode="${1:---check}"
case "$mode" in --check|--apply) shift "$(( $# > 0 ? 1 : 0 ))" ;; *) exit 2 ;; esac
config="/etc/nginx/sites-available/spark"
custom_config=false
trusted_args=()
while (( $# )); do
  case "$1" in
    --trusted-proxy)
      (( $# >= 2 )) || { echo 'Missing CIDR after --trusted-proxy' >&2; exit 2; }
      trusted_args+=("$1" "$2"); shift 2 ;;
    *)
      [[ "$custom_config" == false ]] || { echo 'Expected a single Nginx config path.' >&2; exit 2; }
      config="$1"; custom_config=true; shift ;;
  esac
done
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
patcher="$script_dir/lib/event-client-headers.py"
[[ -f "$config" ]] || { echo "Nginx config not found: $config" >&2; exit 1; }
if [[ "$mode" == --check ]]; then exec python3 "$patcher" --check "$config" "${trusted_args[@]}"; fi
if python3 "$patcher" --check "$config" "${trusted_args[@]}" >/dev/null; then
  echo 'Client IP headers already configured.'
  exit 0
fi
backup="$(mktemp "${config}.pre-event-client-XXXXXX")"
cp -p -- "$config" "$backup"
rollback() {
  cp -p -- "$backup" "$config"
  nginx -t && systemctl reload nginx || true
  echo "Client IP update failed; previous Nginx config restored. Backup: $backup" >&2
}
trap rollback ERR
python3 "$patcher" --apply "$config" "${trusted_args[@]}"
nginx -t
systemctl reload nginx
trap - ERR
printf 'Client IP forwarding enabled. Previous config: %s\n' "$backup"
