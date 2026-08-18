#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

REPO_API="https://api.github.com/repos/hamedplay/Spark"
TARGET="/usr/local/lib/spark-manager"
CLI_PATH="/usr/local/bin/spark"

TUI_VENDOR_REF="52d8e84ce008531f25dfe8339ac9474e1d6feb49"
TUI_VENDOR_RAW="https://raw.githubusercontent.com/sc0ttj/terminal-menus.sh/${TUI_VENDOR_REF}"
TUI_VENDOR_DIR="/usr/local/share/spark-manager"
TUI_VENDOR_REF_FILE="${TUI_VENDOR_DIR}/terminal-menus.ref"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  exec sudo -E "$0" "$@"
fi

command -v curl >/dev/null 2>&1 || {
  echo "curl is required. Install curl first." >&2
  exit 1
}

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
  if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "GitHub API returned an invalid main commit SHA." >&2
    return 1
  fi
  printf '%s\n' "$sha"
}

MAIN_SHA="$(resolve_main_sha)"
RAW_BASE="https://raw.githubusercontent.com/hamedplay/Spark/${MAIN_SHA}/deploy/spark-cli"
printf 'Resolved Spark Manager revision: %s\n' "${MAIN_SHA:0:12}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/lib" "$tmp/vendor"

files=(
  spark
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

printf 'Downloading terminal UI library (%s)...\n' "${TUI_VENDOR_REF:0:12}"
curl -fsSL -H 'Cache-Control: no-cache' \
  "${TUI_VENDOR_RAW}/terminal-menus.sh" \
  -o "${tmp}/vendor/terminal-menus.sh"
curl -fsSL -H 'Cache-Control: no-cache' \
  "${TUI_VENDOR_RAW}/LICENSE.md" \
  -o "${tmp}/vendor/terminal-menus.LICENSE.md"

bash -n "$tmp/spark"
for file in "$tmp"/lib/*.sh; do bash -n "$file"; done
bash -n "$tmp/vendor/terminal-menus.sh"
grep -q '^mainmenu()' "$tmp/vendor/terminal-menus.sh" || {
  echo "Pinned terminal UI library is missing mainmenu()." >&2
  exit 1
}

install -d -m 0755 "$TUI_VENDOR_DIR"
install -m 0644 "$tmp/vendor/terminal-menus.sh" "$TUI_VENDOR_DIR/terminal-menus.sh"
install -m 0644 "$tmp/vendor/terminal-menus.LICENSE.md" "$TUI_VENDOR_DIR/terminal-menus.LICENSE.md"
printf '%s\n' "$TUI_VENDOR_REF" >"$TUI_VENDOR_REF_FILE"
chmod 0644 "$TUI_VENDOR_REF_FILE"

stage="$(mktemp -d /usr/local/lib/spark-manager.new.XXXXXX)"
backup="/usr/local/lib/spark-manager.previous.$$"
install -d -m 0755 "$stage/lib"
install -m 0755 "$tmp/spark" "$stage/spark"
for file in "$tmp"/lib/*.sh; do
  install -m 0644 "$file" "$stage/lib/$(basename "$file")"
done

if [[ -d "$TARGET" ]]; then mv "$TARGET" "$backup"; fi
if ! mv "$stage" "$TARGET"; then
  [[ -d "$backup" ]] && mv "$backup" "$TARGET"
  rm -rf "$stage"
  exit 1
fi
ln -sfn "$TARGET/spark" "$CLI_PATH"

if ! "$CLI_PATH" --version >/dev/null 2>&1; then
  echo "Spark Server Manager smoke test failed; rolling back installation." >&2
  rm -f "$CLI_PATH"
  rm -rf "$TARGET"
  if [[ -d "$backup" ]]; then
    mv "$backup" "$TARGET"
    ln -sfn "$TARGET/spark" "$CLI_PATH"
  fi
  exit 1
fi

rm -rf "$backup"
printf 'Spark Server Manager installed from %s. Run: spark\n' "${MAIN_SHA:0:12}"
