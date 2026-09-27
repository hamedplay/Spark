#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

TARGET=/usr/local/lib/spark-manager
MIGRATE_TARGET=/usr/local/lib/spark-migrate
BIN_DIR=/usr/local/bin
SUDO_HELPER=/usr/local/sbin/spark-manager-airgap-bootstrap
INBOX=/var/tmp/spark-manager-inbox

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  exec sudo -E "$0" "$@"
fi

ROOT="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$ROOT/SHA256SUMS" && -f "$ROOT/metadata/manifest.json" && -d "$ROOT/manager" ]] || {
  echo 'Invalid Spark Manager air-gap bundle.' >&2
  exit 1
}

for cmd in sha256sum python3 install ln mv rm mktemp; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Required command missing: $cmd" >&2; exit 1; }
done

(cd "$ROOT" && sha256sum -c SHA256SUMS)

readarray -t META < <(python3 - "$ROOT/metadata/manifest.json" <<'PY'
import json, sys
p=json.load(open(sys.argv[1], encoding='utf-8'))
for key in ('format_version','spark_revision','ubuntu','architecture'):
    print(p.get(key,''))
PY
)
format="${META[0]:-}"
revision="${META[1]:-}"
os_expected="${META[2]:-}"
arch_expected="${META[3]:-}"
[[ "$format" == 1 ]] || { echo "Unsupported Manager bundle format: $format" >&2; exit 1; }
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid Spark revision in Manager bundle.' >&2; exit 1; }

. /etc/os-release
[[ "${ID:-}" == ubuntu ]] || { echo 'Spark Manager target must be Ubuntu.' >&2; exit 1; }
case "${VERSION_ID:-}" in
  "$os_expected"|"$os_expected".*) ;;
  *) echo "Manager bundle targets Ubuntu $os_expected; this server is ${VERSION_ID:-unknown}." >&2; exit 1 ;;
esac
arch_actual="$(dpkg --print-architecture 2>/dev/null || uname -m)"
[[ "$arch_actual" == "$arch_expected" || ( "$arch_expected" == amd64 && "$arch_actual" == x86_64 ) ]] || {
  echo "Manager bundle architecture is $arch_expected; this server is $arch_actual." >&2
  exit 1
}

python3 - <<'PY'
import curses, pty, selectors
PY

required=(spark spark-airgap spark-architecture spark-database spark-ui.py spark-ui-base.py spark-ui-core.py spark-manager-airgap-bootstrap core architecture config adapters secrets roles lib)
for item in "${required[@]}"; do
  [[ -e "$ROOT/manager/$item" ]] || { echo "Manager payload missing: $item" >&2; exit 1; }
done
[[ -f "$ROOT/manager/lib/spark-manager-airgap" && -f "$ROOT/manager/lib/build-manager-airgap" ]] || {
  echo 'Manager Air-Gap control commands are missing.' >&2
  exit 1
}

python3 -m compileall -q \
  "$ROOT/manager/core" "$ROOT/manager/config" "$ROOT/manager/architecture" \
  "$ROOT/manager/adapters" "$ROOT/manager/secrets" "$ROOT/manager/roles"
bash -n "$ROOT/manager/spark" "$ROOT/manager/spark-airgap" "$ROOT/manager/spark-architecture" "$ROOT/manager/spark-database" "$ROOT/manager/spark-manager-airgap-bootstrap" "$ROOT/manager/lib/spark-manager-airgap" "$ROOT/manager/lib/build-manager-airgap"

stage="$(mktemp -d /usr/local/lib/spark-manager.airgap.XXXXXX)"
trap 'rm -rf "$stage"' EXIT
cp -a "$ROOT/manager/." "$stage/"
printf '%s\n' "$revision" >"$stage/.revision"
chmod 0644 "$stage/.revision"
chmod 0755 "$stage/spark" "$stage/spark-airgap" "$stage/spark-architecture" "$stage/spark-database" "$stage/spark-manager-airgap-bootstrap" "$stage/lib/spark-manager-airgap" "$stage/lib/build-manager-airgap"

backup="${TARGET}.previous.$$"
[[ ! -e "$TARGET" ]] || mv "$TARGET" "$backup"
mv "$stage" "$TARGET"
trap - EXIT
rm -rf "$backup"

ln -sfn "$TARGET/spark" "$BIN_DIR/spark"
ln -sfn "$TARGET/spark-airgap" "$BIN_DIR/spark-airgap"
ln -sfn "$TARGET/spark-architecture" "$BIN_DIR/spark-architecture"
ln -sfn "$TARGET/spark-database" "$BIN_DIR/spark-database"
ln -sfn "$TARGET/lib/spark-manager-airgap" "$BIN_DIR/spark-manager-airgap"
ln -sfn "$TARGET/lib/build-manager-airgap" "$BIN_DIR/build-manager-airgap"
install -m 0755 "$TARGET/spark-manager-airgap-bootstrap" "$SUDO_HELPER"
install -d -m 1777 "$INBOX"
if [[ -f "$TARGET/spark-migrate" ]]; then
  install -d -m 0755 "$MIGRATE_TARGET"
  install -m 0755 "$TARGET/spark-migrate" "$MIGRATE_TARGET/spark-migrate"
  ln -sfn "$MIGRATE_TARGET/spark-migrate" "$BIN_DIR/spark-migrate"
fi

SPARK_MANAGER_REVISION="$revision" "$BIN_DIR/spark-architecture" revision | grep -Fq "Revision: $revision"
"$BIN_DIR/spark" --ui-self-test

printf 'Spark Manager installed from offline bundle.\nRevision: %s\nRun: spark\n' "$revision"
printf 'Restricted update helper: %s\n' "$SUDO_HELPER"
