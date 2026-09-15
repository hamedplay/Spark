# Quiet expected transient readiness failures during Air-Gap observability startup.
# Step 22 polls until the stack is ready; services can legitimately return HTTP
# 503 during that window. Preserve the readiness return code while keeping those
# expected curl diagnostics out of the interactive UI. Final timeout diagnostics
# are still emitted by install_step_22 via livekit_report_observability_failure.

if declare -F livekit_observability_ready >/dev/null 2>&1; then
  eval "$(declare -f livekit_observability_ready | sed '1s/livekit_observability_ready/livekit_observability_ready_with_stderr/')"

  livekit_observability_ready() {
    livekit_observability_ready_with_stderr 2>/dev/null
  }
fi

# Resolve a gateway endpoint that is actually reachable from the target host.
# Air-Gap Step 10 normally publishes api-gw on both 127.0.0.1:8000 and the
# selected internal IPv4. Either endpoint is valid for local validation.
spark_airgap_select_gateway_base() {
  local anon="$1" base
  for base in "http://127.0.0.1:8000" "http://${AIRGAP_SERVER_IP}:8000"; do
    if curl --noproxy '*' -fsS --connect-timeout 3 --max-time 6 \
      -H "apikey: ${anon}" "${base}/auth/v1/health" >/dev/null 2>&1; then
      printf '%s\n' "$base"
      return 0
    fi
  done
  return 1
}

spark_airgap_report_gateway_failure() {
  {
    printf 'Supabase gateway transport diagnostics:\n'
    printf '%s\n' '--- sockets :8000 ---'
    ss -lntp 2>&1 | grep -E ':8000\\b' || true
    printf '%s\n' '--- api-gw compose state ---'
    (cd "$SUPABASE_ROOT" && docker compose ps api-gw) 2>&1 || true
    printf '%s\n' '--- api-gw recent logs ---'
    (cd "$SUPABASE_ROOT" && docker compose logs --no-color --tail=40 api-gw) 2>&1 || true
    printf '%s\n' '--- functions compose state ---'
    (cd "$SUPABASE_ROOT" && docker compose ps functions) 2>&1 || true
    printf '%s\n' '--- functions recent logs ---'
    (cd "$SUPABASE_ROOT" && docker compose logs --no-color --tail=60 functions) 2>&1 || true
  } >>"${CURRENT_LOG:-/dev/null}"
}

# When Step 21 is being re-run specifically to complete DB integration after a
# restore, the database change did not alter Edge Function source code. In that
# state, validate the Kong function route/authorization boundary without forcing
# Edge Runtime to cold-load every function. This is important in true Air-Gap
# mode because a cold worker may otherwise wait on remote module resolution even
# though the restored DB/RPC integration itself is healthy.
spark_airgap_post_restore_guard_probe() {
  local function="$1" gateway_base="$2" code body_file
  body_file="$(mktemp /tmp/spark-post-restore-guard.XXXXXX)"
  code="$(curl --noproxy '*' -sS -o "$body_file" -w '%{http_code}' \
    --connect-timeout 5 --max-time 10 \
    -H 'Content-Type: application/json' \
    -X POST "${gateway_base}/functions/v1/${function}" \
    --data '{}' 2>>"${CURRENT_LOG:-/dev/null}" || true)"

  printf 'Post-restore Edge Function gateway guard %s -> HTTP %s via %s\n' \
    "$function" "${code:-000}" "$gateway_base" >>"${CURRENT_LOG:-/dev/null}"

  # No apikey is intentionally supplied here. Kong must reject the request at
  # the gateway boundary before invoking the Edge Runtime worker.
  if [[ "$code" == "401" || "$code" == "403" ]]; then
    rm -f "$body_file"
    return 0
  fi

  printf 'Post-restore Edge Function gateway guard failed: function=%s http=%s body=' \
    "$function" "${code:-000}" >>"${CURRENT_LOG:-/dev/null}"
  tr '\n' ' ' <"$body_file" | head -c 600 >>"${CURRENT_LOG:-/dev/null}" 2>/dev/null || true
  printf '\n' >>"${CURRENT_LOG:-/dev/null}"
  rm -f "$body_file"
  return 1
}

# Normal validation still proves that each function itself rejects an
# unauthenticated request. Only the post-restore DB-integration pass uses the
# gateway-level guard above.
if declare -F livekit_function_unauthorized_probe >/dev/null 2>&1; then
  livekit_function_unauthorized_probe() {
    local function="$1" anon code body_file deadline gateway_base="" gateway_repaired=0 functions_restarted=0
    anon="$(env_get "${SUPABASE_ROOT}/.env" ANON_KEY)"
    [[ -n "$anon" ]] || {
      printf 'Edge Function guard probe failed: ANON_KEY is missing (%s)\n' "$function" >>"${CURRENT_LOG:-/dev/null}"
      return 1
    }

    if ! gateway_base="$(spark_airgap_select_gateway_base "$anon")"; then
      printf 'Supabase api-gw is not reachable on loopback or internal IPv4; repairing bind.\n' \
        >>"${CURRENT_LOG:-/dev/null}"
      if declare -F airgap_ip_ensure_gateway_bind >/dev/null 2>&1; then
        airgap_ip_ensure_gateway_bind >>"${CURRENT_LOG:-/dev/null}" 2>&1 || true
      fi
      gateway_base="$(spark_airgap_select_gateway_base "$anon" || true)"
    fi

    if [[ -z "$gateway_base" ]]; then
      spark_airgap_report_gateway_failure
      printf 'Edge Function guard failed before request: Supabase api-gw transport is unavailable.\n' \
        >>"${CURRENT_LOG:-/dev/null}"
      return 1
    fi

    # A pending marker is created by the original Air-Gap validation when the
    # application DB is not provisioned yet and is intentionally cleared only
    # after the restored DB contracts have passed. During exactly that pass,
    # validate the gateway authorization boundary without cold-loading workers.
    if [[ -f "${STATE_DIR}/airgap-db-integration.pending" ]]; then
      spark_airgap_post_restore_guard_probe "$function" "$gateway_base"
      return $?
    fi

    printf 'Edge Function guard using gateway endpoint %s\n' "$gateway_base" >>"${CURRENT_LOG:-/dev/null}"
    body_file="$(mktemp /tmp/spark-livekit-function-probe.XXXXXX)"
    deadline=$((SECONDS + 60))

    while true; do
      : >"$body_file"
      code="$(curl --noproxy '*' -sS -o "$body_file" -w '%{http_code}' --connect-timeout 5 --max-time 10 \
        -H "apikey: ${anon}" \
        -H 'Content-Type: application/json' \
        -X POST "${gateway_base}/functions/v1/${function}" \
        --data '{}' 2>>"${CURRENT_LOG:-/dev/null}" || true)"

      printf 'Edge Function %s unauthenticated probe -> HTTP %s via %s\n' \
        "$function" "${code:-000}" "$gateway_base" >>"${CURRENT_LOG:-/dev/null}"

      if [[ "$code" == "401" || "$code" == "403" ]]; then
        rm -f "$body_file"
        return 0
      fi

      if [[ "$code" == "000" && $gateway_repaired -eq 0 ]]; then
        gateway_repaired=1
        if declare -F airgap_ip_ensure_gateway_bind >/dev/null 2>&1; then
          airgap_ip_ensure_gateway_bind >>"${CURRENT_LOG:-/dev/null}" 2>&1 || true
        fi
        gateway_base="$(spark_airgap_select_gateway_base "$anon" || true)"
      fi

      # Restart, but do not force-recreate, the Functions container. Recreating
      # it can discard runtime module cache on an isolated host.
      if [[ "$code" == "000" || "$code" == "404" || "$code" == "500" || "$code" == "502" || "$code" == "503" || "$code" == "504" ]]; then
        if (( functions_restarted == 0 )); then
          printf 'Edge Function runtime not ready (HTTP %s); restarting functions service once without recreation.\n' \
            "${code:-000}" >>"${CURRENT_LOG:-/dev/null}"
          if ( cd "$SUPABASE_ROOT" && docker compose restart functions ) >>"${CURRENT_LOG:-/dev/null}" 2>&1; then
            functions_restarted=1
            sleep 4
            continue
          fi
          functions_restarted=1
        fi
        if (( SECONDS < deadline )) && [[ -n "$gateway_base" ]]; then
          sleep 2
          continue
        fi
      fi

      spark_airgap_report_gateway_failure
      printf 'Edge Function unauthorized guard failed: function=%s http=%s gateway=%s body=' \
        "$function" "${code:-000}" "${gateway_base:-unavailable}" >>"${CURRENT_LOG:-/dev/null}"
      tr '\n' ' ' <"$body_file" | head -c 600 >>"${CURRENT_LOG:-/dev/null}" 2>/dev/null || true
      printf '\n' >>"${CURRENT_LOG:-/dev/null}"
      rm -f "$body_file"
      return 1
    done
  }
fi

# Surface useful transport/runtime diagnostics in the curses output. The base
# validator normally sends command output only to CURRENT_LOG.
if declare -F livekit_airgap_validation_check >/dev/null 2>&1; then
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
      if [[ "$label" == Edge\ Function\ unauthorized\ guard:* ]]; then
        tail -n 100 "$CURRENT_LOG" | grep -E \
          'Post-restore Edge Function|Edge Function .*HTTP|Edge Function guard using|Edge Function runtime|Supabase api-gw|gateway transport|guard failed before request|unauthorized guard failed|functions recent logs|api-gw' \
          | tail -n 12 | tee /dev/stderr >/dev/null || true
      fi
      return "$rc"
    fi
  }
fi
