from pathlib import Path

p = Path('deploy/spark-cli/lib/airgap-ip.sh')
s = p.read_text(encoding='utf-8')
old = r'''livekit_internal_api_exposure_probe() {
  local ufw_status
  ufw_status="$(ufw status verbose 2>/dev/null || true)"
  grep -q 'Status: active' <<<"$ufw_status" || return 1
  ss -lnt | grep -Eq "${AIRGAP_SERVER_IP//./\\.}:${LIVEKIT_INTERNAL_API_PORT}\\b|0\\.0\\.0\\.0:${LIVEKIT_INTERNAL_API_PORT}\\b|\\[::\\]:${LIVEKIT_INTERNAL_API_PORT}\\b" || return 1
  livekit_airgap_http_reachable "http://${AIRGAP_SERVER_IP}:${LIVEKIT_INTERNAL_API_PORT}/" || return 1
  ufw status | grep -Eq "${LIVEKIT_INTERNAL_API_PORT}/tcp|${LIVEKIT_INTERNAL_API_PORT}[[:space:]]" || return 1
}
'''
new = r'''livekit_internal_api_exposure_probe() {
  local ufw_status sockets
  ufw_status="$(ufw status verbose 2>/dev/null || true)"
  grep -q 'Status: active' <<<"$ufw_status" || return 1

  # LiveKit uses host networking and may report a wildcard listener as *:7880.
  # That is acceptable in internal-IP Air-Gap mode only because UFW below must
  # explicitly allow this port to the selected internal server IPv4.
  sockets="$(ss -H -lnt 2>/dev/null || true)"
  grep -Eq "(${AIRGAP_SERVER_IP//./\\.}|0\\.0\\.0\\.0|\\[::\\]|\\*):${LIVEKIT_INTERNAL_API_PORT}\\b" <<<"$sockets" || return 1
  livekit_airgap_http_reachable "http://${AIRGAP_SERVER_IP}:${LIVEKIT_INTERNAL_API_PORT}/" || return 1

  # Do not accept a broad 7880/tcp ALLOW rule. The rule must target the exact
  # internal IPv4 selected for this Air-Gap server.
  ufw status 2>/dev/null | awk -v ip="$AIRGAP_SERVER_IP" -v port="${LIVEKIT_INTERNAL_API_PORT}/tcp" '
    index($0, ip) && index($0, port) && $0 ~ /ALLOW/ { found=1 }
    END { exit(found ? 0 : 1) }
  '
}
'''
if s.count(old) != 1:
    raise SystemExit(f'expected exactly one exposure probe block, found {s.count(old)}')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('Air-Gap LiveKit exposure probe patch: PASS')
