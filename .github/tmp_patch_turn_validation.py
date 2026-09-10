from pathlib import Path

p = Path('deploy/spark-cli/lib/airgap-ip.sh')
text = p.read_text(encoding='utf-8')

start = text.index('test_turn() {\n')
end = text.index('\n}\n\ninstall_step_16() {', start) + 3
new = '''test_turn() {
  local escaped_ip deadline
  escaped_ip="${AIRGAP_SERVER_IP//./\\\\.}"

  deadline=$((SECONDS + 10))
  while (( SECONDS < deadline )); do
    if systemctl is-active --quiet coturn \\
      && ss -lunp 2>/dev/null | grep -Eq "${escaped_ip}:3478([[:space:]]|$)" \\
      && ss -ltnp 2>/dev/null | grep -Eq "${escaped_ip}:3478([[:space:]]|$)"; then
      return 0
    fi
    sleep 1
  done

  if ! systemctl is-active --quiet coturn; then
    echo "ERROR: coturn.service is not active." >>"$CURRENT_LOG"
  elif ! ss -lunp 2>/dev/null | grep -Eq "${escaped_ip}:3478([[:space:]]|$)"; then
    echo "ERROR: Coturn UDP listener is not bound to ${AIRGAP_SERVER_IP}:3478." >>"$CURRENT_LOG"
  elif ! ss -ltnp 2>/dev/null | grep -Eq "${escaped_ip}:3478([[:space:]]|$)"; then
    echo "ERROR: Coturn TCP listener is not bound to ${AIRGAP_SERVER_IP}:3478." >>"$CURRENT_LOG"
  fi
  ss -lunp >>"$CURRENT_LOG" 2>&1 || true
  ss -ltnp >>"$CURRENT_LOG" 2>&1 || true
  journalctl -u coturn --no-pager -n 80 >>"$CURRENT_LOG" 2>&1 || true
  return 1
}

test_turn_stun_probe() {
  local probe_log
  probe_log="$(mktemp)"
  if ! command -v turnutils_stunclient >/dev/null 2>&1; then
    echo "ERROR: turnutils_stunclient is not installed." >>"$CURRENT_LOG"
    rm -f "$probe_log"
    return 1
  fi
  if timeout 8s turnutils_stunclient -L "$AIRGAP_SERVER_IP" -p 3478 "$AIRGAP_SERVER_IP" >"$probe_log" 2>&1; then
    cat "$probe_log" >>"$CURRENT_LOG"
    rm -f "$probe_log"
    return 0
  fi
  echo "ERROR: STUN binding request through the active firewall to ${AIRGAP_SERVER_IP}:3478 failed." >>"$CURRENT_LOG"
  cat "$probe_log" >>"$CURRENT_LOG" 2>&1 || true
  ufw status verbose >>"$CURRENT_LOG" 2>&1 || true
  ss -lunp >>"$CURRENT_LOG" 2>&1 || true
  journalctl -u coturn --no-pager -n 80 >>"$CURRENT_LOG" 2>&1 || true
  rm -f "$probe_log"
  return 1
}
'''
text = text[:start] + new + text[end:]

old16 = 'if run_logged "Validate internal TURN/STUN" test_turn; then mark_step 16; else unmark_step 16; return 1; fi'
new16 = 'if run_logged "Validate internal TURN listeners" test_turn; then mark_step 16; else unmark_step 16; return 1; fi'
if old16 not in text:
    raise SystemExit('Step 16 validation marker not found')
text = text.replace(old16, new16, 1)

old18 = '  if run_logged "Validate internal-IP firewall/exposure" test_firewall; then mark_step 18; else unmark_step 18; return 1; fi\n'
new18 = '''  run_logged "Validate internal-IP firewall/exposure" test_firewall || { unmark_step 18; return 1; }
  if run_logged "Validate STUN through internal-IP firewall" test_turn_stun_probe; then
    mark_step 18
  else
    unmark_step 18
    return 1
  fi
'''
if old18 not in text:
    raise SystemExit('Step 18 validation marker not found')
text = text.replace(old18, new18, 1)

p.write_text(text, encoding='utf-8')

s = text
a = s.index('test_turn() {')
b = s.index('test_turn_stun_probe() {')
assert 'turnutils_stunclient' not in s[a:b]
i16=s.index('install_step_16() {')
i17=s.index('install_step_17() {')
i18=s.index('install_step_18() {')
block16=s[i16:i17]
block18=s[i18:s.index('airgap_full_preflight() {', i18)]
assert 'test_turn_stun_probe' not in block16
assert 'test_turn_stun_probe' in block18
assert block18.index('ufw --force enable') < block18.index('test_turn_stun_probe')
print('TURN validation ordering: PASS')
