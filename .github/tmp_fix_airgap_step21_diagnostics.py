from pathlib import Path

p = Path('deploy/spark-cli/lib/airgap-ip.sh')
s = p.read_text(encoding='utf-8')
start = s.index('livekit_turn_tls_probe() {')
end = s.index('\nlivekit_write_observability_targets() {', start)
old = s[start:end]
new = r'''livekit_turn_tls_probe() {
  turnutils_stunclient -L "$AIRGAP_SERVER_IP" -p "$LIVEKIT_TURN_UDP_PORT" "$AIRGAP_SERVER_IP" >/dev/null 2>&1
}

livekit_airgap_http_reachable() {
  local url="$1" code
  code="$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 "$url" || true)"
  [[ "$code" =~ ^[1-5][0-9][0-9]$ && "$code" != "000" ]]
}

livekit_internal_api_exposure_probe() {
  local ufw_status
  ufw_status="$(ufw status verbose 2>/dev/null || true)"
  grep -q 'Status: active' <<<"$ufw_status" || return 1
  ss -lnt | grep -Eq "${AIRGAP_SERVER_IP//./\\.}:${LIVEKIT_INTERNAL_API_PORT}\\b|0\.0\.0\.0:${LIVEKIT_INTERNAL_API_PORT}\\b|\[::\]:${LIVEKIT_INTERNAL_API_PORT}\\b" || return 1
  livekit_airgap_http_reachable "http://${AIRGAP_SERVER_IP}:${LIVEKIT_INTERNAL_API_PORT}/" || return 1
  ufw status | grep -Eq "${LIVEKIT_INTERNAL_API_PORT}/tcp|${LIVEKIT_INTERNAL_API_PORT}[[:space:]]" || return 1
}

livekit_secret_file_permissions_probe() {
  [[ "$(stat -c '%a' "$LIVEKIT_ENV")" == "600" ]] || return 1
  [[ "$(stat -c '%a' "$AIRGAP_LIVEKIT_OVERRIDE")" == "600" ]] || return 1
}

livekit_configure_speaker_timer_worker() {
  local worker_url="http://${AIRGAP_SERVER_IP}/functions/v1/conference-speaker-timer-enforcer"
  (
    cd "$SUPABASE_ROOT"
    docker compose exec -T db psql -v ON_ERROR_STOP=1 -v worker_url="$worker_url" -U postgres -d postgres <<'SQL'
DO $spark$
BEGIN
  IF to_regprocedure('private.configure_conference_speaker_timer_worker(text)') IS NULL THEN
    RAISE EXCEPTION 'speaker timer worker configuration RPC is missing';
  END IF;
END
$spark$;
SELECT private.configure_conference_speaker_timer_worker(:'worker_url');
SQL
  ) >>"$CURRENT_LOG" 2>&1
}

livekit_configure_phase_worker() {
  local worker_url="http://${AIRGAP_SERVER_IP}/functions/v1/conference-phase-enforcer"
  (
    cd "$SUPABASE_ROOT"
    docker compose exec -T db psql -v ON_ERROR_STOP=1 -v worker_url="$worker_url" -U postgres -d postgres <<'SQL'
DO $spark$
BEGIN
  IF to_regprocedure('private.configure_conference_phase_worker(text)') IS NULL THEN
    RAISE EXCEPTION 'conference phase worker configuration RPC is missing';
  END IF;
END
$spark$;
SELECT private.configure_conference_phase_worker(:'worker_url');
SQL
  ) >>"$CURRENT_LOG" 2>&1
}

livekit_function_unauthorized_probe() {
  local function="$1" anon code body
  anon="$(env_get "${SUPABASE_ROOT}/.env" ANON_KEY)"
  [[ -n "$anon" ]] || { printf 'Edge Function %s: ANON_KEY is missing\n' "$function" >>"$CURRENT_LOG"; return 1; }
  body="$(mktemp)"
  code="$(curl -sS -o "$body" -w '%{http_code}' --connect-timeout 5 \
    -H "apikey: ${anon}" \
    -H 'Content-Type: application/json' \
    -X POST "http://127.0.0.1:8000/functions/v1/${function}" \
    --data '{}' || true)"
  printf 'Edge Function %s unauthenticated probe -> HTTP %s\n' "$function" "${code:-000}" >>"$CURRENT_LOG"
  if [[ "$code" != "401" && "$code" != "403" ]]; then
    sed -n '1,20p' "$body" >>"$CURRENT_LOG" 2>/dev/null || true
    rm -f "$body"
    return 1
  fi
  rm -f "$body"
}

livekit_airgap_listener_probe() {
  local protocol="$1" port="$2" sockets
  case "$protocol" in
    tcp) sockets="$(ss -H -lntp 2>/dev/null || true)" ;;
    udp) sockets="$(ss -H -lunp 2>/dev/null || true)" ;;
    *) return 1 ;;
  esac
  grep -Eq "(${AIRGAP_SERVER_IP//./\\.}|0\.0\.0\.0|\[::\]|\*):${port}\\b" <<<"$sockets"
}

livekit_airgap_minio_listener_probe() {
  ss -H -lntp 2>/dev/null | grep -Eq '127\.0\.0\.1:9000\b'
}

livekit_airgap_ufw_probe() {
  local port="$1" proto="$2" status
  status="$(ufw status 2>/dev/null || true)"
  grep -q 'Status: active' <<<"$status" || return 1
  grep -Eiq "(^|[[:space:]])${port}(/${proto})?([[:space:]]|$).*ALLOW|ALLOW.*(^|[[:space:]])${port}(/${proto})?([[:space:]]|$)" <<<"$status"
}

livekit_airgap_validation_check() {
  local label="$1" rc
  shift
  printf '[CHECK] %s\n' "$label" | tee -a "$CURRENT_LOG"
  if "$@" >>"$CURRENT_LOG" 2>&1; then
    printf '[PASS] %s\n' "$label" | tee -a "$CURRENT_LOG"
    return 0
  else
    rc=$?
    printf '[FAIL] %s (rc=%s)\n' "$label" "$rc" | tee -a "$CURRENT_LOG" >&2
    return "$rc"
  fi
}

livekit_airgap_validation_report_failure() {
  {
    printf '\n=== LiveKit Compose state ===\n'
    livekit_compose ps 2>&1 || true
    printf '\n=== Listening sockets ===\n'
    ss -lntup 2>&1 || true
    printf '\n=== UFW status ===\n'
    ufw status verbose 2>&1 || true
  } >>"$CURRENT_LOG"
}

test_livekit_full_validation() {
  local function

  livekit_airgap_validation_check "LiveKit internal-IP configuration" test_livekit_config || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "LiveKit runtime readiness" livekit_runtime_ready || { livekit_report_start_failure; livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "LiveKit signaling TCP 7880 listener" livekit_airgap_listener_probe tcp 7880 || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "LiveKit ICE TCP 7881 listener" livekit_airgap_listener_probe tcp 7881 || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "LiveKit embedded TURN UDP 443 listener" livekit_airgap_listener_probe udp 443 || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "LiveKit ingress RTMP TCP 1935 listener" livekit_airgap_listener_probe tcp 1935 || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "LiveKit ingress RTC UDP 7885 listener" livekit_airgap_listener_probe udp 7885 || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "Local MinIO TCP 9000 listener" livekit_airgap_minio_listener_probe || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "Local MinIO readiness" curl -fsS --connect-timeout 3 http://127.0.0.1:9000/minio/health/ready || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "LiveKit internal HTTP reachability" livekit_public_tls_probe "$AIRGAP_SERVER_IP" || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "LiveKit embedded TURN STUN UDP 443" livekit_turn_tls_probe || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "LiveKit RoomService API smoke test" livekit_api_smoke || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "Configure speaker timer worker" livekit_configure_speaker_timer_worker || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "Configure conference phase worker" livekit_configure_phase_worker || { livekit_airgap_validation_report_failure; return 1; }

  for function in \
    conference-livekit-token conference-host-control conference-recording \
    conference-speaker-timer-control conference-speaker-queue-control conference-speaker-timer-enforcer \
    conference-phase-control conference-phase-enforcer conference-chat-control conference-private-chat-control \
    conference-moderator-chat-control conference-reaction conference-poll-control conference-whiteboard-control \
    conference-presentation-control livekit-webhook; do
    livekit_airgap_validation_check "Edge Function unauthorized guard: ${function}" livekit_function_unauthorized_probe "$function" || { livekit_airgap_validation_report_failure; return 1; }
  done

  livekit_airgap_validation_check "LiveKit secret leak scan" livekit_secret_leak_probe || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "LiveKit secret file permissions" livekit_secret_file_permissions_probe || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "LiveKit internal API exposure" livekit_internal_api_exposure_probe || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "Legacy Coturn is disabled" bash -c '! systemctl is-active --quiet coturn 2>/dev/null' || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "UFW embedded TURN UDP 443 rule" livekit_airgap_ufw_probe 443 udp || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "UFW LiveKit signaling TCP 7880 rule" livekit_airgap_ufw_probe 7880 tcp || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "UFW LiveKit ICE TCP 7881 rule" livekit_airgap_ufw_probe 7881 tcp || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "UFW LiveKit RTC UDP 50000:60000 rule" livekit_airgap_ufw_probe '50000:60000' udp || { livekit_airgap_validation_report_failure; return 1; }
  return 0
}
'''
s = s[:start] + new + s[end:]
p.write_text(s, encoding='utf-8')

out = p.read_text(encoding='utf-8')
for needle in (
    'turnutils_stunclient -L "$AIRGAP_SERVER_IP"',
    'livekit_airgap_validation_check()',
    '[FAIL] %s (rc=%s)',
    'Edge Function unauthorized guard: ${function}',
    'LiveKit embedded TURN STUN UDP 443',
):
    if needle not in out:
        raise SystemExit(f'missing patch marker: {needle}')
print('Air-Gap Step 21 diagnostics patch: PASS')
