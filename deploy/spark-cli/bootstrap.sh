#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

TARGET="/usr/local/lib/spark-manager"
MIGRATE_TARGET="/usr/local/lib/spark-migrate"
BIN_DIR="/usr/local/bin"
INBOX="/var/tmp/spark-manager-inbox"
REPO_URL="https://github.com/hamedplay/Spark.git"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'Run this installer as root (example: curl -fsSL .../bootstrap.sh | sudo bash).' >&2
  exit 1
fi

for cmd in git install ln mv rm mktemp cp bash python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Required command missing: $cmd" >&2; exit 1; }
done

if [[ -t 1 ]]; then
  C_CYAN=$'\033[36m'
  C_GREEN=$'\033[32m'
  C_DIM=$'\033[2m'
  C_BOLD=$'\033[1m'
  C_RESET=$'\033[0m'
else
  C_CYAN=''
  C_GREEN=''
  C_DIM=''
  C_BOLD=''
  C_RESET=''
fi

step() {
  printf '%s[%s]%s %s\n' "$C_CYAN" "$1" "$C_RESET" "$2"
}

done_step() {
  printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"
}

tmp="$(mktemp -d)"
stage=""
trap 'rm -rf "$tmp" "${stage:-}"' EXIT

printf '\n%s%sSpark Manager installer%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
printf '%sFast install from GitHub main%s\n\n' "$C_DIM" "$C_RESET"

step '1/3' 'Downloading latest Spark Manager...'
REPO_URL="$REPO_URL" CLONE_PATH="$tmp/repo" python3 <<'PYDOWNLOAD'
from __future__ import annotations

import os
import re
import subprocess
import sys

repo_url = os.environ["REPO_URL"]
clone_path = os.environ["CLONE_PATH"]
width = 40
is_tty = sys.stderr.isatty()
last_reported = -1
milestones = {-1}


def render(percent: int, final: bool = False) -> None:
    global last_reported
    percent = max(0, min(100, percent))
    if percent == last_reported and not final:
        return
    last_reported = percent
    filled = int(width * percent / 100)
    bar = "█" * filled + "░" * (width - filled)
    text = f"  [{bar}]  {percent:3d}%"

    if is_tty:
        sys.stderr.write("\r" + text)
        sys.stderr.flush()
        if final:
            sys.stderr.write("\n")
            sys.stderr.flush()
    else:
        # Keep redirected logs compact while preserving real progress values.
        bucket = (percent // 25) * 25
        if percent == 100:
            bucket = 100
        if bucket not in milestones:
            milestones.add(bucket)
            sys.stderr.write(text + "\n")
            sys.stderr.flush()


render(0)
cmd = [
    "git",
    "-c", "advice.detachedHead=false",
    "clone",
    "--depth", "1",
    "--single-branch",
    "--branch", "main",
    "--no-tags",
    "--progress",
    repo_url,
    clone_path,
]
env = os.environ.copy()
env["GIT_PROGRESS_DELAY"] = "0"
proc = subprocess.Popen(
    cmd,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.PIPE,
    env=env,
)

buffer = b""
errors: list[str] = []
pattern = re.compile(r"Receiving objects:\s+(\d+)%")

while True:
    chunk = proc.stderr.read(4096) if proc.stderr is not None else b""
    if not chunk:
        break
    buffer += chunk
    parts = re.split(br"[\r\n]", buffer)
    buffer = parts.pop() if parts else b""
    for raw in parts:
        if not raw:
            continue
        line = raw.decode("utf-8", errors="replace").strip()
        match = pattern.search(line)
        if match:
            render(int(match.group(1)))
        elif any(token in line.lower() for token in ("fatal:", "error:", "failed")):
            errors.append(line)

if buffer:
    line = buffer.decode("utf-8", errors="replace").strip()
    match = pattern.search(line)
    if match:
        render(int(match.group(1)))
    elif any(token in line.lower() for token in ("fatal:", "error:", "failed")):
        errors.append(line)

return_code = proc.wait()
if return_code != 0:
    if is_tty:
        sys.stderr.write("\n")
    message = errors[-1] if errors else f"git clone exited with code {return_code}"
    raise SystemExit(f"Download failed: {message}")

render(100, final=True)
PYDOWNLOAD
done_step 'Download complete.'

step '2/3' 'Validating package...'
source_dir="$tmp/repo/deploy/spark-cli"
[[ -f "$source_dir/spark" && -f "$source_dir/spark-ui.py" && -d "$source_dir/lib" ]] || {
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
done_step 'Package ready.'

step '3/3' 'Installing Spark Manager...'
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
done_step 'Spark Manager installed/updated successfully.'
printf '\nRun: %sspark%s\n' "$C_GREEN" "$C_RESET"
