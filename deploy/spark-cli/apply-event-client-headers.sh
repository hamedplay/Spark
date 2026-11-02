#!/usr/bin/env bash
# Preserve routing/TLS; overwrite spoofable IP headers at Spark's Nginx ingress.
set -Eeuo pipefail
mode="${1:---check}"
case "$mode" in --check|--apply) shift "$(( $# > 0 ? 1 : 0 ))" ;; *) exit 2 ;; esac
[[ $# -le 1 ]] || { echo 'Expected at most one Nginx config path.' >&2; exit 2; }
config="${1:-/etc/nginx/sites-available/spark}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
patcher="$script_dir/lib/event-client-headers.py"
[[ -f "$config" ]] || { echo "Nginx config not found: $config" >&2; exit 1; }
if [[ "$mode" == --check ]]; then exec python3 "$patcher" --check "$config"; fi
if python3 "$patcher" --check "$config" >/dev/null; then
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
python3 "$patcher" --apply "$config"
nginx -t
systemctl reload nginx
trap - ERR
printf 'Client IP forwarding enabled. Previous config: %s\n' "$backup"
