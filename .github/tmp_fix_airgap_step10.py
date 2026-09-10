from pathlib import Path
import subprocess

runtime = Path('deploy/spark-cli/lib/airgap-runtime.sh')
text = runtime.read_text(encoding='utf-8')
old = '''install_step_10() {\n  airgap_is_active || { install_step_10_online; return; }\n  local root\n  root="$(airgap_current_root)" || { fail "No active air-gap bundle."; return 1; }\n'''
new = '''install_step_10() {\n  airgap_is_active || { install_step_10_online; return; }\n  title\n  new_log "install-10-airgap-runtime"\n  local root\n  root="$(airgap_current_root)" || { fail "No active air-gap bundle."; return 1; }\n'''
if old not in text:
    raise SystemExit('airgap-runtime step 10 block not found')
runtime.write_text(text.replace(old, new, 1), encoding='utf-8')

ipfile = Path('deploy/spark-cli/lib/airgap-ip.sh')
text = ipfile.read_text(encoding='utf-8')
old = '''airgap_ip_ensure_gateway_bind() {\n  local compose_file="${SUPABASE_ROOT}/docker-compose.yml" deadline\n  require_file "$compose_file" || return 1\n\n  COMPOSE_FILE="$compose_file" AIRGAP_IP="$AIRGAP_SERVER_IP" python3 - <<'PY'\nimport os,yaml\nfrom pathlib import Path\np=Path(os.environ['COMPOSE_FILE'])\nd=yaml.safe_load(p.read_text(encoding='utf-8'))\nservices=d.get('services') if isinstance(d,dict) else None\nif not isinstance(services,dict) or 'api-gw' not in services:\n    raise SystemExit('docker-compose.yml is missing api-gw')\nip=os.environ['AIRGAP_IP']\nservices['api-gw']['ports']=[\n    '127.0.0.1:8000:8000/tcp',\n    f'{ip}:8000:8000/tcp',\n]\np.write_text(yaml.safe_dump(d,sort_keys=False,default_flow_style=False),encoding='utf-8')\nPY\n\n  (cd "$SUPABASE_ROOT" && docker compose config --quiet) || return 1\n  (cd "$SUPABASE_ROOT" && docker compose up -d --no-deps api-gw) || return 1\n\n  deadline=$((SECONDS + 30))\n  while (( SECONDS < deadline )); do\n    if curl --noproxy '*' -fsS --connect-timeout 3 "http://${AIRGAP_SERVER_IP}:8000/auth/v1/health" >/dev/null 2>&1; then\n      return 0\n    fi\n    sleep 1\n  done\n  return 1\n}\n'''
new = '''airgap_ip_gateway_bind_present() {\n  local cid\n  cid="$(cd "$SUPABASE_ROOT" && docker compose ps -q api-gw 2>/dev/null)"\n  [[ -n "$cid" ]] || return 1\n  AIRGAP_IP="$AIRGAP_SERVER_IP" docker inspect "$cid" | python3 -c '\nimport json,os,sys\nd=json.load(sys.stdin)\nports=((d[0].get("NetworkSettings") or {}).get("Ports") or {}).get("8000/tcp") or []\nhosts={(str(x.get("HostIp","")),str(x.get("HostPort",""))) for x in ports}\nip=os.environ["AIRGAP_IP"]\nraise SystemExit(0 if ("127.0.0.1","8000") in hosts and (ip,"8000") in hosts else 1)\n'\n}\n\nairgap_ip_ensure_gateway_bind() {\n  local compose_file="${SUPABASE_ROOT}/docker-compose.yml" deadline\n  require_file "$compose_file" || return 1\n\n  COMPOSE_FILE="$compose_file" AIRGAP_IP="$AIRGAP_SERVER_IP" python3 - <<'PY'\nimport os,yaml\nfrom pathlib import Path\np=Path(os.environ['COMPOSE_FILE'])\nd=yaml.safe_load(p.read_text(encoding='utf-8'))\nservices=d.get('services') if isinstance(d,dict) else None\nif not isinstance(services,dict) or 'api-gw' not in services:\n    raise SystemExit('docker-compose.yml is missing api-gw')\nip=os.environ['AIRGAP_IP']\nservices['api-gw']['ports']=[\n    '127.0.0.1:8000:8000/tcp',\n    f'{ip}:8000:8000/tcp',\n]\np.write_text(yaml.safe_dump(d,sort_keys=False,default_flow_style=False),encoding='utf-8')\nPY\n\n  (cd "$SUPABASE_ROOT" && docker compose config --quiet) || return 1\n\n  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -Fq 'Status: active'; then\n    ufw allow to "$AIRGAP_SERVER_IP" port 8000 proto tcp >/dev/null || return 1\n  fi\n\n  (cd "$SUPABASE_ROOT" && docker compose up -d --no-deps --force-recreate api-gw) || return 1\n  airgap_ip_gateway_bind_present || {\n    echo "ERROR: api-gw container does not publish both 127.0.0.1:8000 and ${AIRGAP_SERVER_IP}:8000" >>"$CURRENT_LOG"\n    (cd "$SUPABASE_ROOT" && docker compose ps api-gw) >>"$CURRENT_LOG" 2>&1 || true\n    return 1\n  }\n\n  deadline=$((SECONDS + 45))\n  while (( SECONDS < deadline )); do\n    if curl --noproxy '*' -fsS --connect-timeout 3 "http://${AIRGAP_SERVER_IP}:8000/auth/v1/health" >/dev/null 2>&1; then\n      return 0\n    fi\n    sleep 1\n  done\n  echo "ERROR: api-gw is published on ${AIRGAP_SERVER_IP}:8000 but its health endpoint did not become reachable." >>"$CURRENT_LOG"\n  (cd "$SUPABASE_ROOT" && docker compose ps api-gw) >>"$CURRENT_LOG" 2>&1 || true\n  ss -lntp >>"$CURRENT_LOG" 2>&1 || true\n  return 1\n}\n'''
if old not in text:
    raise SystemExit('airgap-ip gateway helper block not found')
ipfile.write_text(text.replace(old, new, 1), encoding='utf-8')

for f in [runtime, ipfile]:
    subprocess.run(['bash','-n',str(f)], check=True)

rt = runtime.read_text(encoding='utf-8')
ip = ipfile.read_text(encoding='utf-8')
assert 'new_log "install-10-airgap-runtime"' in rt
assert '--force-recreate api-gw' in ip
assert 'airgap_ip_gateway_bind_present' in ip
assert 'ufw allow to "$AIRGAP_SERVER_IP" port 8000 proto tcp' in ip
subprocess.run(['git','diff','--check'], check=True)
print('Step 10 patch validation: PASS')
