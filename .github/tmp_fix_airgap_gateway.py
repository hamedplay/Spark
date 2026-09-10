from pathlib import Path
import subprocess
import tempfile
import textwrap
import yaml

repo = Path.cwd()
target = repo / 'deploy/spark-cli/lib/airgap-ip.sh'
text = target.read_text(encoding='utf-8')

marker = '''install_step_10() {\n  install_step_10_airgap_base || return 1\n  new_log "install-10-airgap-ip-access"\n  if run_logged "Expose PostgreSQL session endpoint only on ${AIRGAP_SERVER_IP}:5432" airgap_ip_provision_database_access; then\n'''
if marker not in text:
    raise SystemExit('expected Step 10 block not found')

helper = '''airgap_ip_ensure_gateway_bind() {
  local compose_file="${SUPABASE_ROOT}/docker-compose.yml" deadline
  require_file "$compose_file" || return 1

  COMPOSE_FILE="$compose_file" AIRGAP_IP="$AIRGAP_SERVER_IP" python3 - <<'PY'
import os,yaml
from pathlib import Path
p=Path(os.environ['COMPOSE_FILE'])
d=yaml.safe_load(p.read_text(encoding='utf-8'))
services=d.get('services') if isinstance(d,dict) else None
if not isinstance(services,dict) or 'api-gw' not in services:
    raise SystemExit('docker-compose.yml is missing api-gw')
ip=os.environ['AIRGAP_IP']
services['api-gw']['ports']=[
    '127.0.0.1:8000:8000/tcp',
    f'{ip}:8000:8000/tcp',
]
p.write_text(yaml.safe_dump(d,sort_keys=False,default_flow_style=False),encoding='utf-8')
PY

  (cd "$SUPABASE_ROOT" && docker compose config --quiet) || return 1
  (cd "$SUPABASE_ROOT" && docker compose up -d --no-deps api-gw) || return 1

  deadline=$((SECONDS + 30))
  while (( SECONDS < deadline )); do
    if curl --noproxy '*' -fsS --connect-timeout 3 "http://${AIRGAP_SERVER_IP}:8000/auth/v1/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

'''
replacement = '''install_step_10() {\n  install_step_10_airgap_base || return 1\n  new_log "install-10-airgap-ip-access"\n  run_logged "Ensure Supabase gateway bind on ${AIRGAP_SERVER_IP}:8000" airgap_ip_ensure_gateway_bind || { unmark_step 10; return 1; }\n  if run_logged "Expose PostgreSQL session endpoint only on ${AIRGAP_SERVER_IP}:5432" airgap_ip_provision_database_access; then\n'''
text = text.replace(marker, helper + replacement, 1)
target.write_text(text, encoding='utf-8')

subprocess.run(['bash', '-n', str(target)], check=True)
if 'docker compose up -d --no-deps api-gw' not in text:
    raise SystemExit('gateway recreate command missing')
if 'Ensure Supabase gateway bind on ${AIRGAP_SERVER_IP}:8000' not in text:
    raise SystemExit('Step 10 reconciliation call missing')

with tempfile.TemporaryDirectory() as td:
    work = Path(td)
    supa = work / 'supabase'
    supa.mkdir()
    compose = supa / 'docker-compose.yml'
    compose.write_text(textwrap.dedent('''\
        services:
          api-gw:
            image: example.invalid/api-gw:test
            ports:
              - 127.0.0.1:8000:8000/tcp
          db:
            image: example.invalid/db:test
    '''), encoding='utf-8')

    start = text.index('airgap_ip_ensure_gateway_bind() {')
    end = text.index('\n}\n\ninstall_step_10() {', start) + 2
    helper_file = work / 'helper.sh'
    helper_file.write_text(text[start:end] + '\n', encoding='utf-8')
    run_file = work / 'run.sh'
    run_file.write_text(textwrap.dedent('''\
        #!/usr/bin/env bash
        set -Eeuo pipefail
        SUPABASE_ROOT="$1"
        AIRGAP_SERVER_IP=10.211.36.178
        require_file() { [[ -f "$1" ]]; }
        docker() { return 0; }
        curl() { return 0; }
        source "$2"
        airgap_ip_ensure_gateway_bind
    '''), encoding='utf-8')
    run_file.chmod(0o755)
    subprocess.run([str(run_file), str(supa), str(helper_file)], check=True)

    data = yaml.safe_load(compose.read_text(encoding='utf-8'))
    ports = data['services']['api-gw']['ports']
    expected = ['127.0.0.1:8000:8000/tcp', '10.211.36.178:8000:8000/tcp']
    if ports != expected:
        raise SystemExit(f'unexpected reconciled ports: {ports!r}')

subprocess.run(['git', 'diff', '--check'], check=True)
print('Air-Gap gateway reconciliation validation: PASS')
