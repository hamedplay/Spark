#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

REPO_API="https://api.github.com/repos/hamedplay/Spark"
TARGET="/usr/local/lib/spark-manager"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  exec sudo -E "$0" "$@"
fi

command -v curl >/dev/null 2>&1 || {
  echo "curl is required. Install curl first." >&2
  exit 1
}
command -v python3 >/dev/null 2>&1 || {
  echo "python3 is required for Spark Manager bootstrap." >&2
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
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
    echo "GitHub API returned an invalid Spark Manager revision." >&2
    return 1
  }
  printf '%s\n' "$sha"
}

MAIN_SHA="$(resolve_main_sha)"
RAW_BASE="https://raw.githubusercontent.com/hamedplay/Spark/${MAIN_SHA}/deploy/spark-cli"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf 'Resolved Spark Manager revision: %s\n' "${MAIN_SHA:0:12}"
printf 'Running stable bootstrap base...\n'
curl -fsSL -H 'Cache-Control: no-cache' "${RAW_BASE}/bootstrap-base.sh" -o "$tmp/bootstrap-base.sh"
python3 - "$tmp/bootstrap-base.sh" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")

architecture_check = 'SPARK_ENV_PROFILE="$tmp/config/environments/example.production.yaml" python3 "$tmp/spark-architecture" validate >/dev/null\n'
if architecture_check not in text:
    raise SystemExit("bootstrap-base architecture validation contract changed; refusing unsafe patch")
text = text.replace(architecture_check, '', 1)

# spark-ui.py is now a thin extension wrapper and intentionally inherits its
# version from spark-ui-base.py. The legacy bootstrap expected a literal
# SPARK_UI_VERSION assignment in the wrapper itself, so that grep is obsolete.
ui_wrapper_check = '''grep -Fq "SPARK_UI_VERSION = \\\"${EXPECTED_UI_VERSION}\\\"" "$tmp/spark-ui.py" || {
  echo "Spark UI version validation failed." >&2
  exit 1
}
'''
if ui_wrapper_check not in text:
    raise SystemExit("bootstrap-base UI wrapper validation contract changed; refusing unsafe patch")
text = text.replace(ui_wrapper_check, '', 1)

path.write_text(text, encoding="utf-8")
PY
chmod 0755 "$tmp/bootstrap-base.sh"
SPARK_MANAGER_REVISION="$MAIN_SHA" "$tmp/bootstrap-base.sh" "$@"

printf 'Synchronizing final integration package from the same revision...\n'
python3 - "$MAIN_SHA" "$TARGET" <<'PY'
from __future__ import annotations
import json, os, sys, tempfile, urllib.request
from pathlib import Path
sha, target_value = sys.argv[1:]
target = Path(target_value)
repo = "hamedplay/Spark"
source_root = "deploy/spark-cli/"
prefixes = (
    "deploy/spark-cli/core/", "deploy/spark-cli/config/", "deploy/spark-cli/architecture/",
    "deploy/spark-cli/adapters/", "deploy/spark-cli/secrets/", "deploy/spark-cli/roles/",
    "deploy/spark-cli/lib/",
)
explicit_files = {
    "deploy/spark-cli/spark-ui-base.py",
    "deploy/spark-cli/spark-manager-airgap-bootstrap",
}
headers = {"Accept": "application/vnd.github+json", "User-Agent": "spark-manager-bootstrap", "Cache-Control": "no-cache"}
def read_url(url: str) -> bytes:
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()
tree = json.loads(read_url(f"https://api.github.com/repos/{repo}/git/trees/{sha}?recursive=1").decode("utf-8"))
if tree.get("truncated"):
    raise SystemExit("GitHub returned a truncated repository tree; refusing incomplete manager sync")
selected = []
for item in tree.get("tree", []):
    path = str(item.get("path", ""))
    if item.get("type") == "blob" and (path in explicit_files or path.startswith(prefixes)):
        selected.append(path)
required = {
    "deploy/spark-cli/core/workflow.py",
    "deploy/spark-cli/roles/environment/orchestrator.py",
    "deploy/spark-cli/roles/environment/remote/executor.py",
    "deploy/spark-cli/roles/environment/remote/ssh.py",
    "deploy/spark-cli/roles/reverse_proxy/workflow.py",
    "deploy/spark-cli/roles/application/edge/runtime.py",
    "deploy/spark-cli/roles/application/livekit/runtime.py",
    "deploy/spark-cli/roles/application/coturn/runtime.py",
    "deploy/spark-cli/lib/airgap-manager.sh",
    "deploy/spark-cli/lib/spark-manager-airgap",
    "deploy/spark-cli/lib/build-manager-airgap",
    "deploy/spark-cli/spark-manager-airgap-bootstrap",
}
missing = sorted(required.difference(selected))
if missing:
    raise SystemExit("Final integration package is incomplete: " + ", ".join(missing))
for source_path in sorted(selected):
    relative = source_path.removeprefix(source_root)
    destination = target / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = read_url(f"https://raw.githubusercontent.com/{repo}/{sha}/{source_path}")
    fd, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", dir=str(destination.parent))
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload); handle.flush(); os.fsync(handle.fileno())
        os.chmod(temporary_name, 0o644)
        os.replace(temporary_name, destination)
    except Exception:
        try: os.unlink(temporary_name)
        except FileNotFoundError: pass
        raise
revision = target / ".revision"
revision.write_text(sha + "\n", encoding="utf-8")
os.chmod(revision, 0o644)
print(f"Synced {len(selected)} integration package files from {sha[:12]}")
PY

chmod 0755 "$TARGET/lib/spark-manager-airgap" "$TARGET/lib/build-manager-airgap" "$TARGET/spark-manager-airgap-bootstrap"
ln -sfn "$TARGET/lib/spark-manager-airgap" /usr/local/bin/spark-manager-airgap
ln -sfn "$TARGET/lib/build-manager-airgap" /usr/local/bin/build-manager-airgap
install -m 0755 "$TARGET/spark-manager-airgap-bootstrap" /usr/local/sbin/spark-manager-airgap-bootstrap
install -d -m 1777 /var/tmp/spark-manager-inbox

python3 -m compileall -q "$TARGET/core" "$TARGET/config" "$TARGET/architecture" "$TARGET/adapters" "$TARGET/secrets" "$TARGET/roles"
bash -n "$TARGET/lib/spark-manager-airgap" "$TARGET/lib/build-manager-airgap" "$TARGET/spark-manager-airgap-bootstrap"
SPARK_ENV_PROFILE="$TARGET/config/environments/example.production.yaml" /usr/local/bin/spark-architecture validate >/dev/null
SPARK_MANAGER_REVISION="$MAIN_SHA" /usr/local/bin/spark-architecture revision | grep -Fq "Revision: $MAIN_SHA"
printf 'Spark Manager final integration package validation: OK\n'
