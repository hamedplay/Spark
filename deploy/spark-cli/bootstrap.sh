#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

RAW_BASE="https://raw.githubusercontent.com/hamedplay/Spark/main/deploy/spark-cli"
TARGET="/usr/local/lib/spark-manager"
CLI_PATH="/usr/local/bin/spark"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  exec sudo -E "$0" "$@"
fi

command -v curl >/dev/null 2>&1 || {
  echo "curl is required. Install curl first." >&2
  exit 1
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/lib"
files=(
  spark
  lib/core.sh
  lib/install-base.sh
  lib/install-platform.sh
  lib/tests-backup.sh
  lib/update.sh
  lib/admin.sh
)
for file in "${files[@]}"; do
  echo "Downloading ${file}..."
  curl -fsSL "${RAW_BASE}/${file}" -o "${tmp}/${file}"
done

bash -n "$tmp/spark"
for file in "$tmp"/lib/*.sh; do bash -n "$file"; done

stage="$(mktemp -d /usr/local/lib/spark-manager.new.XXXXXX)"
backup="/usr/local/lib/spark-manager.previous.$$"
install -d -m 0755 "$stage/lib"
install -m 0755 "$tmp/spark" "$stage/spark"
for file in "$tmp"/lib/*.sh; do install -m 0644 "$file" "$stage/lib/$(basename "$file")"; done

if [[ -d "$TARGET" ]]; then mv "$TARGET" "$backup"; fi
if ! mv "$stage" "$TARGET"; then
  [[ -d "$backup" ]] && mv "$backup" "$TARGET"
  rm -rf "$stage"
  exit 1
fi
ln -sfn "$TARGET/spark" "$CLI_PATH"
rm -rf "$backup"

echo "Spark Server Manager installed. Run: spark"
