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

# A database restore restarts the Supabase stack. Edge Runtime/Kong can therefore
# be reachable slightly later than PostgreSQL. Step 21 must still prove that an
# unauthenticated request is rejected, but transient startup responses should not
# fail the validation immediately. Only 401/403 is accepted as a successful guard.
# If the Functions runtime is stale after restore, recreate only that service once
# and retry; this does not weaken the security assertion.
if declare -F livekit_function_unauthorized_probe >/dev/null 2>&1; then
  livekit_function_unauthorized_probe() {
    local function="$1" anon code body_file deadline functions_restarted=0
    anon="$(env_get "${SUPABASE_ROOT}/.env" ANON_KEY)"
    [[ -n "$anon" ]] || {
      printf 'Edge Function guard probe failed: ANON_KEY is missing (%s)\n' "$function" >>"${CURRENT_LOG:-/dev/null}"
      return 1
    }

    body_file="$(mktemp /tmp/spark-livekit-function-probe.XXXXXX)"
    deadline=$((SECONDS + 45))

    while true; do
      : >"$body_file"
      code="$(curl -sS -o "$body_file" -w '%{http_code}' --connect-timeout 5 --max-time 10 \
        -H "apikey: ${anon}" \
        -H 'Content-Type: application/json' \
        -X POST "http://127.0.0.1:8000/functions/v1/${function}" \
        --data '{}' 2>>"${CURRENT_LOG:-/dev/null}" || true)"

      printf 'Edge Function %s unauthenticated probe -> HTTP %s\n' \
        "$function" "${code:-000}" >>"${CURRENT_LOG:-/dev/null}"

      if [[ "$code" == "401" || "$code" == "403" ]]; then
        rm -f "$body_file"
        return 0
      fi

      # A restore can leave Kong reachable before the Functions runtime has
      # reloaded all function routes/imports. Recreate only the Functions service
      # once for gateway/runtime startup failures, then continue polling.
      if [[ "$code" == "000" || "$code" == "404" || "$code" == "500" || "$code" == "502" || "$code" == "503" || "$code" == "504" ]]; then
        if (( functions_restarted == 0 )); then
          printf 'Edge Function runtime not ready after restore (HTTP %s); recreating functions service once.\n' \
            "${code:-000}" >>"${CURRENT_LOG:-/dev/null}"
          if ( cd "$SUPABASE_ROOT" && docker compose up -d --force-recreate functions ) >>"${CURRENT_LOG:-/dev/null}" 2>&1; then
            functions_restarted=1
            sleep 4
            continue
          fi
          printf 'Unable to recreate Supabase functions service.\n' >>"${CURRENT_LOG:-/dev/null}"
        fi
        if (( SECONDS < deadline )); then
          sleep 2
          continue
        fi
      fi

      printf 'Edge Function unauthorized guard failed: function=%s http=%s body=' \
        "$function" "${code:-000}" >>"${CURRENT_LOG:-/dev/null}"
      tr '\n' ' ' <"$body_file" | head -c 600 >>"${CURRENT_LOG:-/dev/null}" 2>/dev/null || true
      printf '\n' >>"${CURRENT_LOG:-/dev/null}"
      rm -f "$body_file"
      return 1
    done
  }
fi

# Surface the useful HTTP diagnostic in the curses output when an Air-Gap
# validation check fails. The original validator sends command output only to
# CURRENT_LOG, which previously hid the actual Edge Function response code/body.
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
        tail -n 8 "$CURRENT_LOG" | grep -E 'Edge Function .*HTTP|Edge Function runtime|unauthorized guard failed|Unable to recreate' \
          | tail -n 4 | tee /dev/stderr >/dev/null || true
      fi
      return "$rc"
    fi
  }
fi
