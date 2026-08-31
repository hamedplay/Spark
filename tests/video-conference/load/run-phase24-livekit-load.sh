#!/usr/bin/env bash
set -euo pipefail

for key in PHASE24_LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET; do
  [[ -n "${!key:-}" ]] || {
    echo "Missing required environment variable: ${key}" >&2
    exit 2
  }
done

version="${PHASE24_LK_VERSION:-2.18.4}"
duration="${PHASE24_LOAD_DURATION:-2m}"
join_rate="${PHASE24_LOAD_JOIN_RATE:-5}"
packet_loss_max="${PHASE24_LOAD_PACKET_LOSS_MAX_PERCENT:-5}"
room="${PHASE24_LOAD_ROOM:-phase24-load-$(date -u +%Y%m%d%H%M%S)}"

case "$room" in
  phase24-load-*) ;;
  *)
    echo "Refusing to run against a non-test room: $room" >&2
    echo "Room name must start with phase24-load-" >&2
    exit 2
    ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 2
    ;;
esac

ulimit -n 65535 || {
  echo "Unable to raise open-file limit to 65535" >&2
  exit 2
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

asset="lk_${version}_linux_${arch}.tar.gz"
base="https://github.com/livekit/livekit-cli/releases/download/v${version}"

curl -fsSL --retry 3 "$base/checksums.txt" -o "$tmp/checksums.txt"
curl -fsSL --retry 3 "$base/$asset" -o "$tmp/$asset"

grep -E "[[:space:]]+${asset}$" "$tmp/checksums.txt" >"$tmp/asset.sha256" || {
  echo "Release checksum for $asset was not found" >&2
  exit 2
}

(
  cd "$tmp"
  sha256sum -c asset.sha256
)

tar -xzf "$tmp/$asset" -C "$tmp"
lk_bin="$(find "$tmp" -maxdepth 2 -type f -name lk -perm -u+x | head -n 1)"
[[ -n "$lk_bin" ]] || {
  echo "lk binary was not found in release archive" >&2
  exit 2
}

actual_version="$("$lk_bin" --version)"
grep -q "$version" <<<"$actual_version" || {
  echo "Unexpected LiveKit CLI version: $actual_version" >&2
  exit 2
}

export HOME="$tmp/home"
mkdir -p "$HOME/.livekit"
chmod 700 "$HOME/.livekit"

PHASE24_CONFIG="$HOME/.livekit/cli-config.yaml" \
PHASE24_LIVEKIT_URL="$PHASE24_LIVEKIT_URL" \
LIVEKIT_API_KEY="$LIVEKIT_API_KEY" \
LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET" \
python3 - <<'PY'
import json
import os
from pathlib import Path

path = Path(os.environ["PHASE24_CONFIG"])
payload = {
    "default_project": "phase24-load",
    "projects": [
        {
            "name": "phase24-load",
            "url": os.environ["PHASE24_LIVEKIT_URL"],
            "api_key": os.environ["LIVEKIT_API_KEY"],
            "api_secret": os.environ["LIVEKIT_API_SECRET"],
        }
    ],
}
path.write_text(json.dumps(payload))
path.chmod(0o600)
PY

output="$tmp/load-test.log"

echo "Phase 24 LiveKit load test"
echo "Room             : $room"
echo "Participants     : 20 total"
echo "Publishers       : 10 audio+video"
echo "Subscribers      : 10"
echo "Duration         : $duration"
echo "Join rate        : $join_rate/s"
echo "Layout           : 4x4"
echo "Simulcast        : enabled"

set +e
NO_COLOR=1 CLICOLOR=0 "$lk_bin" perf load-test \
  --room "$room" \
  --duration "$duration" \
  --video-publishers 10 \
  --audio-publishers 10 \
  --subscribers 10 \
  --layout 4x4 \
  --num-per-second "$join_rate" \
  --simulate-speakers \
  2>&1 | tee "$output"
status=${PIPESTATUS[0]}
set -e

(( status == 0 )) || {
  echo "lk load-test exited with status $status" >&2
  exit "$status"
}

if grep -Eqi 'could not connect|track subscription failed|panic|fatal' "$output"; then
  echo "Load test reported connection/subscription errors" >&2
  exit 1
fi

PHASE24_LOAD_OUTPUT="$output" \
PHASE24_PACKET_LOSS_MAX="$packet_loss_max" \
python3 - <<'PY'
import os
import re
from pathlib import Path

text = Path(os.environ["PHASE24_LOAD_OUTPUT"]).read_text(
    errors="replace",
)
# Strip ANSI escapes in case the CLI still emits terminal styling.
text = re.sub(r"\x1b\[[0-9;]*m", "", text)

total_lines = [
    line for line in text.splitlines()
    if re.search(r"\bTotal\b", line)
]
if not total_lines:
    raise SystemExit("Subscriber Total summary was not found")

line = total_lines[-1]
losses = [
    float(value)
    for value in re.findall(r"([0-9]+(?:\.[0-9]+)?)%", line)
]
if not losses:
    raise SystemExit(
        "Packet-loss percentage was not found in Total summary: " + line
    )

loss = losses[-1]
limit = float(os.environ["PHASE24_PACKET_LOSS_MAX"])
if loss > limit:
    raise SystemExit(
        f"Packet loss {loss:.2f}% exceeded threshold {limit:.2f}%"
    )

# In the summary the final column is the subscriber error count.
numbers = re.findall(r"\b([0-9]+)\b", line)
if not numbers:
    raise SystemExit("Error count was not found in Total summary")
errors = int(numbers[-1])
if errors != 0:
    raise SystemExit(f"Subscriber error count is {errors}")

print(
    f"PASS total_participants=20 packet_loss={loss:.2f}% "
    f"subscriber_errors={errors}"
)
PY
