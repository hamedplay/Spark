#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

TARGET="/usr/local/lib/spark-manager"
MIGRATE_TARGET="/usr/local/lib/spark-migrate"
BIN_DIR="/usr/local/bin"
INBOX="/var/tmp/spark-manager-inbox"
ARCHIVE_URL="https://codeload.github.com/hamedplay/Spark/tar.gz/refs/heads/main"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'Run this installer as root (example: curl -fsSL .../bootstrap.sh | sudo bash).' >&2
  exit 1
fi

for cmd in curl tar find install ln mv rm mktemp cp bash python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Required command missing: $cmd" >&2; exit 1; }
done

tmp="$(mktemp -d)"
stage=""
trap 'rm -rf "$tmp" "${stage:-}"' EXIT

echo 'Downloading latest Spark Manager...'
curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 10 --max-time 300 \
  "$ARCHIVE_URL" -o "$tmp/spark-main.tar.gz"
tar -xzf "$tmp/spark-main.tar.gz" -C "$tmp"
source_dir="$(find "$tmp" -type d -path '*/deploy/spark-cli' -print -quit)"
[[ -n "$source_dir" && -f "$source_dir/spark" && -f "$source_dir/spark-ui.py" && -d "$source_dir/lib" ]] || {
  echo 'Downloaded Spark Manager payload is incomplete.' >&2
  exit 1
}

# Fast local syntax checks only; no revision/version/checksum matching.
bash -n "$source_dir/spark"
[[ ! -f "$source_dir/spark-airgap" ]] || bash -n "$source_dir/spark-airgap"
[[ ! -f "$source_dir/spark-migrate" ]] || bash -n "$source_dir/spark-migrate"
for file in "$source_dir"/lib/*.sh; do bash -n "$file"; done
python3 - "$source_dir/spark-ui.py" "$source_dir/spark-ui-core.py" "$source_dir/spark-architecture" "$source_dir/spark-database" <<'PYCODE'
from pathlib import Path
import sys
for value in sys.argv[1:]:
    path = Path(value)
    if path.is_file():
        compile(path.read_text(encoding='utf-8'), str(path), 'exec')
PYCODE

install -d -m 0755 /usr/local/lib "$BIN_DIR"
stage="$(mktemp -d /usr/local/lib/spark-manager.new.XXXXXX)"
cp -a "$source_dir/." "$stage/"
chmod 0755 "$stage/spark"
for file in spark-airgap spark-architecture spark-database spark-migrate spark-manager-airgap-bootstrap; do
  [[ ! -f "$stage/$file" ]] || chmod 0755 "$stage/$file"
done
for file in "$stage/lib/spark-manager-airgap" "$stage/lib/build-manager-airgap"; do
  [[ ! -f "$file" ]] || chmod 0755 "$file"
done

backup="${TARGET}.previous.$$"
[[ ! -e "$TARGET" ]] || mv "$TARGET" "$backup"
if ! mv "$stage" "$TARGET"; then
  [[ ! -e "$backup" ]] || mv "$backup" "$TARGET"
  exit 1
fi
stage=""

ln -sfn "$TARGET/spark" "$BIN_DIR/spark"
[[ ! -f "$TARGET/spark-airgap" ]] || ln -sfn "$TARGET/spark-airgap" "$BIN_DIR/spark-airgap"
[[ ! -f "$TARGET/spark-architecture" ]] || ln -sfn "$TARGET/spark-architecture" "$BIN_DIR/spark-architecture"
[[ ! -f "$TARGET/spark-database" ]] || ln -sfn "$TARGET/spark-database" "$BIN_DIR/spark-database"
[[ ! -f "$TARGET/lib/spark-manager-airgap" ]] || ln -sfn "$TARGET/lib/spark-manager-airgap" "$BIN_DIR/spark-manager-airgap"
[[ ! -f "$TARGET/lib/build-manager-airgap" ]] || ln -sfn "$TARGET/lib/build-manager-airgap" "$BIN_DIR/build-manager-airgap"

if [[ -f "$TARGET/spark-migrate" ]]; then
  install -d -m 0755 "$MIGRATE_TARGET"
  install -m 0755 "$TARGET/spark-migrate" "$MIGRATE_TARGET/spark-migrate"
  ln -sfn "$MIGRATE_TARGET/spark-migrate" "$BIN_DIR/spark-migrate"
fi
if [[ -f "$TARGET/spark-manager-airgap-bootstrap" ]]; then
  install -m 0755 "$TARGET/spark-manager-airgap-bootstrap" /usr/local/sbin/spark-manager-airgap-bootstrap
  install -d -m 1777 "$INBOX"
fi

rm -rf "$backup"
echo 'Spark Manager installed/updated successfully.'
echo 'Run: spark'
