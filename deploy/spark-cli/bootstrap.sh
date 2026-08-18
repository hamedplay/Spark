#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

REPO_API="https://api.github.com/repos/hamedplay/Spark"
TARGET="/usr/local/lib/spark-manager"
CLI_PATH="/usr/local/bin/spark"
EXPECTED_VERSION="2.0.0"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  exec sudo -E "$0" "$@"
fi

command -v curl >/dev/null 2>&1 || {
  echo "curl is required. Install curl first." >&2
  exit 1
}
command -v python3 >/dev/null 2>&1 || {
  echo "python3 is required for the Spark curses UI." >&2
  exit 1
}
python3 - <<'PY'
import curses, pty, selectors
PY

resolve_main_sha() {
  local response sha
  response="$(curl -fsSL -H 'Accept: application/vnd.github+json' \
    -H 'Cache-Control: no-cache' \
    "${REPO_API}/commits/main?nocache=$(date +%s)")" || {
      echo "Unable to resolve current Spark main commit from GitHub API." >&2
      return 1
    }
  sha="$(printf '%s' "$response" \
    | grep -m1 -Eo '"sha"[[:space:]]*:[[:space:]]*"[0-9a-f]{40}"' \
    | grep -Eo '[0-9a-f]{40}' || true)"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
    echo "GitHub API returned an invalid main commit SHA." >&2
    return 1
  }
  printf '%s\n' "$sha"
}

MAIN_SHA="$(resolve_main_sha)"
RAW_BASE="https://raw.githubusercontent.com/hamedplay/Spark/${MAIN_SHA}/deploy/spark-cli"
printf 'Resolved Spark Manager revision: %s\n' "${MAIN_SHA:0:12}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/lib"

files=(
  spark
  spark-ui.py
  lib/core.sh
  lib/install-base.sh
  lib/install-platform-a.sh
  lib/install-platform-b.sh
  lib/install-platform-c.sh
  lib/tests-backup.sh
  lib/update.sh
  lib/admin.sh
)

for file in "${files[@]}"; do
  echo "Downloading ${file}..."
  curl -fsSL -H 'Cache-Control: no-cache' "${RAW_BASE}/${file}" -o "${tmp}/${file}"
done

bash -n "$tmp/spark"
for file in "$tmp"/lib/*.sh; do bash -n "$file"; done
python3 - "$tmp/spark-ui.py" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
compile(path.read_text(encoding="utf-8"), str(path), "exec")
PY
python3 "$tmp/spark-ui.py" --self-test

grep -q 'SPARK_MANAGER_VERSION="2.0.0"' "$tmp/spark" || {
  echo "Spark Manager version validation failed." >&2
  exit 1
}
grep -q 'SPARK_UI_VERSION = "2.0.0"' "$tmp/spark-ui.py" || {
  echo "Spark UI version validation failed." >&2
  exit 1
}
grep -q 'pty.openpty()' "$tmp/spark-ui.py" || {
  echo "Spark UI PTY backend validation failed." >&2
  exit 1
}
grep -q 'curses.doupdate()' "$tmp/spark-ui.py" || {
  echo "Spark UI differential refresh validation failed." >&2
  exit 1
}
if grep -Eq 'terminal-menus|mainmenu\(|TUI_VENDOR' "$tmp/spark-ui.py"; then
  echo "Spark UI unexpectedly depends on the retired terminal-menus runtime." >&2
  exit 1
fi

stage="$(mktemp -d /usr/local/lib/spark-manager.new.XXXXXX)"
backup="/usr/local/lib/spark-manager.previous.$$"
install -d -m 0755 "$stage/lib"
install -m 0755 "$tmp/spark" "$stage/spark"
install -m 0644 "$tmp/spark-ui.py" "$stage/spark-ui.py"
for file in "$tmp"/lib/*.sh; do
  install -m 0644 "$file" "$stage/lib/$(basename "$file")"
done

if [[ -d "$TARGET" ]]; then
  mv "$TARGET" "$backup"
fi
if ! mv "$stage" "$TARGET"; then
  [[ -d "$backup" ]] && mv "$backup" "$TARGET"
  rm -rf "$stage"
  exit 1
fi
ln -sfn "$TARGET/spark" "$CLI_PATH"

rollback_manager() {
  rm -f "$CLI_PATH"
  rm -rf "$TARGET"
  if [[ -d "$backup" ]]; then
    mv "$backup" "$TARGET"
    ln -sfn "$TARGET/spark" "$CLI_PATH"
  fi
}

if ! version_output="$($CLI_PATH --version 2>/dev/null)"; then
  echo "Spark Server Manager version smoke test failed; rolling back." >&2
  rollback_manager
  exit 1
fi
if [[ "$version_output" != "Spark Server Manager ${EXPECTED_VERSION}" ]]; then
  echo "Unexpected Spark Server Manager version: ${version_output}" >&2
  rollback_manager
  exit 1
fi
if ! "$CLI_PATH" --ui-self-test >/dev/null 2>&1; then
  echo "Spark curses UI smoke test failed; rolling back." >&2
  rollback_manager
  exit 1
fi

rm -rf "$backup"
rm -rf /usr/local/share/spark-manager 2>/dev/null || true
printf 'Spark Server Manager %s installed from %s. Run: spark\n' "$EXPECTED_VERSION" "${MAIN_SHA:0:12}"
