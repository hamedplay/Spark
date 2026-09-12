from pathlib import Path

p = Path('deploy/spark-cli/lib/airgap-ip.sh')
s = p.read_text(encoding='utf-8')
start = s.index('livekit_internal_api_exposure_probe() {')
end = s.index('\nlivekit_secret_file_permissions_probe()', start)
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
s = s[:start] + new + s[end:]
p.write_text(s, encoding='utf-8')
print('Air-Gap LiveKit exposure probe patch: PASS')
