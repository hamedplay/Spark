from pathlib import Path

p=Path('deploy/spark-cli/lib/airgap-ip.sh')
s=p.read_text(encoding='utf-8')
old=r'''  if spark_application_database_provisioned; then
    livekit_airgap_validation_check "Conference worker DB contracts" livekit_worker_config_contracts_ready || { livekit_airgap_validation_report_failure; return 1; }
    livekit_airgap_validation_check "Configure speaker timer worker" livekit_configure_speaker_timer_worker || { livekit_airgap_validation_report_failure; return 1; }
    livekit_airgap_validation_check "Configure conference phase worker" livekit_configure_phase_worker || { livekit_airgap_validation_report_failure; return 1; }
    livekit_clear_database_integration_pending
  else
    livekit_defer_database_integration
  fi

  for function in \
    conference-livekit-token conference-host-control conference-recording \
    conference-speaker-timer-control conference-speaker-queue-control conference-speaker-timer-enforcer \
    conference-phase-control conference-phase-enforcer conference-chat-control conference-private-chat-control \
    conference-moderator-chat-control conference-reaction conference-poll-control conference-whiteboard-control \
    conference-presentation-control livekit-webhook; do
    livekit_airgap_validation_check "Edge Function unauthorized guard: ${function}" livekit_function_unauthorized_probe "$function" || { livekit_airgap_validation_report_failure; return 1; }
  done
'''
new=r'''  if spark_application_database_provisioned; then
    livekit_airgap_validation_check "Conference worker DB contracts" livekit_worker_config_contracts_ready || { livekit_airgap_validation_report_failure; return 1; }
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

    livekit_clear_database_integration_pending
  else
    livekit_defer_database_integration
    printf '[DEFER] Spark application Edge Function guards are deferred until database restore.\n' | tee -a "$CURRENT_LOG"
  fi
'''
if s.count(old)!=1:
    raise SystemExit(f'expected one Step 21 app integration block, found {s.count(old)}')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
text=p.read_text(encoding='utf-8')
assert '[DEFER] Spark application Edge Function guards are deferred until database restore.' in text
assert text.index('for function in \\\n      conference-livekit-token') > text.index('if spark_application_database_provisioned; then')
print('Air-Gap application integration defer patch: PASS')
