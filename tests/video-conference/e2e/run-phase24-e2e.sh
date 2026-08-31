#!/usr/bin/env bash
set -euo pipefail

required=(
  PHASE24_CONFERENCE_URL
  PHASE24_HOST_NAME
  PHASE24_PARTICIPANT_NAME
  PHASE24_HOST_STORAGE_STATE
  PHASE24_PARTICIPANT_STORAGE_STATE
)

for key in "${required[@]}"; do
  [[ -n "${!key:-}" ]] || {
    echo "Missing required environment variable: ${key}" >&2
    exit 2
  }
done

host_state="$(realpath "$PHASE24_HOST_STORAGE_STATE")"
participant_state="$(realpath "$PHASE24_PARTICIPANT_STORAGE_STATE")"

[[ -f "$host_state" ]] || {
  echo "Host storage state does not exist: $host_state" >&2
  exit 2
}
[[ -f "$participant_state" ]] || {
  echo "Participant storage state does not exist: $participant_state" >&2
  exit 2
}

image="${PHASE24_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.62.0-noble}"

docker run --rm --init --ipc=host \
  -v "$PWD/tests/video-conference/e2e:/suite:ro" \
  -v "$host_state:/state/host.json:ro" \
  -v "$participant_state:/state/participant.json:ro" \
  -e PHASE24_CONFERENCE_URL \
  -e PHASE24_HOST_NAME \
  -e PHASE24_PARTICIPANT_NAME \
  -e PHASE24_HOST_STORAGE_STATE=/state/host.json \
  -e PHASE24_PARTICIPANT_STORAGE_STATE=/state/participant.json \
  -e PHASE24_E2E_REQUIRE_COUNTDOWN="${PHASE24_E2E_REQUIRE_COUNTDOWN:-0}" \
  -e PHASE24_E2E_RECORDING="${PHASE24_E2E_RECORDING:-0}" \
  -e PHASE24_E2E_SCREEN_SHARE="${PHASE24_E2E_SCREEN_SHARE:-1}" \
  --entrypoint bash \
  "$image" \
  -lc '
    set -euo pipefail
    work=/tmp/phase24-e2e
    mkdir -p "$work"
    cd "$work"
    npm init -y >/dev/null
    npm install --no-save --no-audit --no-fund playwright@1.62.0 >/dev/null
    node /suite/phase24ConferenceE2E.mjs
  '
