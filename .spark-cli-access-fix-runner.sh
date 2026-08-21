#!/usr/bin/env bash
set -Eeuo pipefail

ORIGINAL_CI_COMMIT="3a251eca1804a930d5f1daedf4c4c4e5a59fe4a7"

python3 - <<'PY'
from pathlib import Path

path = Path('deploy/spark-cli/lib/admin.sh')
text = path.read_text(encoding='utf-8')
start = text.index('open_supabase_admin_access() {')
end = text.index('resource_status() {', start)
block = r'''external_access_requirements() {
  require_manager_values || return 1
  require_file "${SUPABASE_ROOT}/docker-compose.yml" || return 1
  require_file "${SUPABASE_ROOT}/.env" || return 1
  if ! ufw status 2>/dev/null | grep -q '^Status: active'; then
    fail "UFW فعال نیست؛ برای اینکه دسترسی موقت فقط به CIDR انتخابی محدود بماند، ابتدا Firewall مرحله 20 را فعال کنید."
    return 1
  fi
}

prompt_external_access_cidr() {
  local var_name="$1" label="$2" value
  while true; do
    prompt_default value "$label" "${ADMIN_CIDR:-}"
    if valid_cidr "$value"; then
      printf -v "$var_name" '%s' "$value"
      return 0
    fi
    fail "CIDR معتبر نیست؛ مثال: 203.0.113.10/32"
  done
}

ufw_remove_temporary_rule() {
  local cidr="$1" port="$2"
  [[ -n "$cidr" ]] || return 0
  if ufw status 2>/dev/null | grep -q '^Status: active'; then
    set +e
    ufw --force delete allow from "$cidr" to any port "$port" proto tcp >>"$CURRENT_LOG" 2>&1
    set -e
  fi
}

patch_database_external_mapping() {
  local mode="$1"
  COMPOSE_FILE="${SUPABASE_ROOT}/docker-compose.yml" MODE="$mode" python3 - <<'PY'
import os
from pathlib import Path
import yaml

path = Path(os.environ['COMPOSE_FILE'])
data = yaml.safe_load(path.read_text(encoding='utf-8'))
services = data.get('services') if isinstance(data, dict) else None
if not isinstance(services, dict) or 'supavisor' not in services:
    raise SystemExit('Supavisor service not found; refusing to guess compose service names')
svc = services['supavisor']
ports = svc.get('ports') or []
kept = []
for item in ports:
    if isinstance(item, str):
        value = item
        if value.endswith(':5432/tcp') or value.endswith(':5432'):
            continue
        kept.append(item)
        continue
    if isinstance(item, dict):
        target = str(item.get('target', ''))
        published = str(item.get('published', ''))
        if target == '5432' or published in {'5432', '5433'}:
            continue
        kept.append(item)
        continue
    kept.append(item)
new_ports = ['127.0.0.1:5433:5432/tcp']
if os.environ['MODE'] == 'open':
    new_ports.append('0.0.0.0:5432:5432/tcp')
elif os.environ['MODE'] != 'close':
    raise SystemExit('invalid exposure mode')
new_ports.extend(kept)
svc['ports'] = new_ports
path.write_text(yaml.safe_dump(data, sort_keys=False, default_flow_style=False), encoding='utf-8')
PY
}

show_operator_credentials() {
  title
  new_log "operator-credentials"
  require_manager_values || return 1
  require_file "${SUPABASE_ROOT}/.env" || return 1
  local db_password dashboard_user dashboard_password db_state studio_state public_ip
  db_password="$(env_get "${SUPABASE_ROOT}/.env" POSTGRES_PASSWORD)"
  dashboard_user="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_USERNAME)"
  dashboard_password="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_PASSWORD)"
  dashboard_user="${dashboard_user:-supabase}"
  public_ip="${TURN_PUBLIC_IP:-}"
  [[ -n "$db_password" ]] || { fail "POSTGRES_PASSWORD در Supabase .env پیدا نشد."; return 1; }
  [[ -n "$dashboard_password" ]] || { fail "DASHBOARD_PASSWORD در Supabase .env پیدا نشد."; return 1; }
  db_state="CLOSED"
  if ss -lnt 2>/dev/null | grep -Eq '(^|[[:space:]])(0\.0\.0\.0|\*):5432[[:space:]]'; then db_state="OPEN"; fi
  studio_state="CLOSED"
  if ss -lnt 2>/dev/null | grep -Eq '(^|[[:space:]])(0\.0\.0\.0|\*):8443[[:space:]]|\[::\]:8443[[:space:]]'; then studio_state="OPEN"; fi
  printf '\n%s%sOperator credentials%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
  printf '%s\n' '────────────────────────────────────────────────────────────'
  printf '%s\n' 'PostgreSQL / Supavisor'
  printf '  Database : postgres\n  Username : postgres\n  Password : %s\n  Local    : 127.0.0.1:5433\n' "$db_password"
  if [[ -n "$public_ip" ]]; then printf '  External : %s:5432  [%s]\n' "$public_ip" "$db_state"; else printf '  External : <server-ip>:5432  [%s]\n' "$db_state"; fi
  printf '\n%s\n' 'Supabase Studio dashboard'
  printf '  Username : %s\n  Password : %s\n  URL      : https://%s:8443  [%s]\n' "$dashboard_user" "$dashboard_password" "$API_DOMAIN" "$studio_state"
  printf '%s\n' '────────────────────────────────────────────────────────────'
  warn "این صفحه Secretهای داخلی مانند JWT_SECRET و SERVICE_ROLE_KEY را عمداً نمایش نمی‌دهد."
  info "مقادیر رمز در log فایل Spark Manager نوشته نمی‌شوند."
}

open_database_external_access() {
  title
  new_log "database-access-open"
  external_access_requirements || return 1
  local access_cidr compose_file backup state_file
  prompt_external_access_cidr access_cidr "CIDR مجاز برای PostgreSQL خارجی روی TCP/5432" || return 1
  if ! confirm_word "PostgreSQL-compatible access از طریق Supavisor روی ${TURN_PUBLIC_IP:-server}:5432 فقط برای ${access_cidr} باز می‌شود." "OPEN"; then warn "لغو شد."; return 1; fi
  compose_file="${SUPABASE_ROOT}/docker-compose.yml"
  backup="$(mktemp)"
  state_file="${STATE_DIR}/database-access.cidr"
  cp -a "$compose_file" "$backup"
  if ! patch_database_external_mapping open; then cp -a "$backup" "$compose_file"; rm -f "$backup"; return 1; fi
  if ! run_logged "Validate Docker Compose" bash -c "cd '$SUPABASE_ROOT' && docker compose config --quiet"; then cp -a "$backup" "$compose_file"; rm -f "$backup"; return 1; fi
  if ! run_logged "UFW allow PostgreSQL from selected CIDR" ufw allow from "$access_cidr" to any port 5432 proto tcp; then cp -a "$backup" "$compose_file"; rm -f "$backup"; return 1; fi
  if ! run_logged "Publish Supavisor PostgreSQL listener on host 5432" bash -c "cd '$SUPABASE_ROOT' && docker compose up -d --force-recreate supavisor"; then
    ufw_remove_temporary_rule "$access_cidr" 5432
    cp -a "$backup" "$compose_file"
    bash -c "cd '$SUPABASE_ROOT' && docker compose up -d --force-recreate supavisor" >>"$CURRENT_LOG" 2>&1 || true
    rm -f "$backup"
    return 1
  fi
  rm -f "$backup"
  printf '%s\n' "$access_cidr" >"$state_file"; chmod 600 "$state_file"
  if ! ss -lnt 2>/dev/null | grep -Eq '(^|[[:space:]])(0\.0\.0\.0|\*):5432[[:space:]]'; then fail "Listener خارجی TCP/5432 ایجاد نشد."; return 1; fi
  if ! timeout 3 bash -c '</dev/tcp/127.0.0.1/5432' >/dev/null 2>&1; then fail "TCP/5432 listen است ولی اتصال محلی برقرار نشد."; return 1; fi
  ok "Database access باز شد: ${TURN_PUBLIC_IP:-<server-ip>}:5432 — فقط ${access_cidr}"
  info "Username=postgres  Database=postgres؛ رمز را از گزینه Show operator credentials ببینید."
}

close_database_external_access() {
  title
  new_log "database-access-close"
  require_file "${SUPABASE_ROOT}/docker-compose.yml" || return 1
  local compose_file backup state_file access_cidr
  compose_file="${SUPABASE_ROOT}/docker-compose.yml"; backup="$(mktemp)"; state_file="${STATE_DIR}/database-access.cidr"; access_cidr=""
  [[ -f "$state_file" ]] && access_cidr="$(tr -d '[:space:]' <"$state_file")"
  cp -a "$compose_file" "$backup"
  if ! patch_database_external_mapping close; then cp -a "$backup" "$compose_file"; rm -f "$backup"; return 1; fi
  if ! run_logged "Validate Docker Compose" bash -c "cd '$SUPABASE_ROOT' && docker compose config --quiet"; then cp -a "$backup" "$compose_file"; rm -f "$backup"; return 1; fi
  if ! run_logged "Remove external PostgreSQL listener" bash -c "cd '$SUPABASE_ROOT' && docker compose up -d --force-recreate supavisor"; then
    cp -a "$backup" "$compose_file"; bash -c "cd '$SUPABASE_ROOT' && docker compose up -d --force-recreate supavisor" >>"$CURRENT_LOG" 2>&1 || true; rm -f "$backup"; return 1
  fi
  rm -f "$backup"; ufw_remove_temporary_rule "$access_cidr" 5432; rm -f "$state_file"
  if ss -lnt 2>/dev/null | grep -Eq '(^|[[:space:]])(0\.0\.0\.0|\*):5432[[:space:]]|\[::\]:5432[[:space:]]'; then fail "هنوز listener عمومی دیگری روی TCP/5432 وجود دارد."; ss -lntp | grep ':5432' | tee -a "$CURRENT_LOG" || true; return 1; fi
  ok "دسترسی خارجی Database بسته شد؛ listener داخلی 127.0.0.1:5433 حفظ شده است."
}

open_supabase_admin_access() {
  title
  new_log "supabase-studio-open"
  external_access_requirements || return 1
  require_file "/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem" || return 1
  require_file "/etc/letsencrypt/live/${API_DOMAIN}/privkey.pem" || return 1
  if [[ ! -e /etc/nginx/sites-enabled/spark ]]; then fail "Nginx Production فعال نیست؛ ابتدا مرحله 16 نصب را اجرا کنید."; return 1; fi
  local access_cidr dashboard_user dashboard_password state_file
  prompt_external_access_cidr access_cidr "CIDR مجاز برای Supabase Studio روی HTTPS/8443" || return 1
  dashboard_user="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_USERNAME)"; dashboard_password="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_PASSWORD)"; dashboard_user="${dashboard_user:-supabase}"
  [[ -n "$dashboard_password" ]] || { fail "DASHBOARD_PASSWORD موجود نیست."; return 1; }
  if ! confirm_word "Supabase Studio از مسیر Kong با TLS روی https://${API_DOMAIN}:8443 فقط برای ${access_cidr} باز می‌شود." "OPEN"; then warn "لغو شد."; return 1; fi
  cat >/etc/nginx/sites-available/spark-supabase-admin <<EOF
server {
    listen 8443 ssl;
    listen [::]:8443 ssl;
    server_name ${API_DOMAIN};
    ssl_certificate /etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${API_DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    allow 127.0.0.1;
    allow ::1;
    allow ${access_cidr};
    deny all;
    client_max_body_size 50m;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$spark_connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
EOF
  ln -sfn /etc/nginx/sites-available/spark-supabase-admin /etc/nginx/sites-enabled/spark-supabase-admin
  if ! run_logged "Nginx config test" nginx -t; then rm -f /etc/nginx/sites-enabled/spark-supabase-admin /etc/nginx/sites-available/spark-supabase-admin; return 1; fi
  if ! run_logged "UFW allow Supabase Studio from selected CIDR" ufw allow from "$access_cidr" to any port 8443 proto tcp; then rm -f /etc/nginx/sites-enabled/spark-supabase-admin /etc/nginx/sites-available/spark-supabase-admin; return 1; fi
  if ! run_logged "Reload Nginx" systemctl reload nginx; then ufw_remove_temporary_rule "$access_cidr" 8443; rm -f /etc/nginx/sites-enabled/spark-supabase-admin /etc/nginx/sites-available/spark-supabase-admin; return 1; fi
  state_file="${STATE_DIR}/supabase-studio-access.cidr"; printf '%s\n' "$access_cidr" >"$state_file"; chmod 600 "$state_file"
  if ! ss -lnt 2>/dev/null | grep -Eq '(^|[[:space:]])(0\.0\.0\.0|\*):8443[[:space:]]|\[::\]:8443[[:space:]]'; then fail "Port 8443 listen نشد."; return 1; fi
  if ! curl -fsSkL --connect-timeout 5 --max-time 12 --resolve "${API_DOMAIN}:8443:127.0.0.1" -u "${dashboard_user}:${dashboard_password}" "https://${API_DOMAIN}:8443/" -o /dev/null; then
    fail "Gateway روی 8443 بالا آمد ولی Supabase Studio از مسیر Kong پاسخ معتبر نداد؛ تغییرات rollback می‌شوند."
    rm -f /etc/nginx/sites-enabled/spark-supabase-admin /etc/nginx/sites-available/spark-supabase-admin; ufw_remove_temporary_rule "$access_cidr" 8443; rm -f "$state_file"; nginx -t >>"$CURRENT_LOG" 2>&1 && systemctl reload nginx >>"$CURRENT_LOG" 2>&1 || true; return 1
  fi
  ok "Supabase Studio باز شد: https://${API_DOMAIN}:8443 — فقط ${access_cidr}"
  info "Username=${dashboard_user}؛ رمز را از گزینه Show operator credentials ببینید."
}

close_supabase_admin_access() {
  title
  new_log "supabase-studio-close"
  local state_file access_cidr
  state_file="${STATE_DIR}/supabase-studio-access.cidr"; access_cidr=""
  [[ -f "$state_file" ]] && access_cidr="$(tr -d '[:space:]' <"$state_file")"
  rm -f /etc/nginx/sites-enabled/spark-supabase-admin /etc/nginx/sites-available/spark-supabase-admin
  ufw_remove_temporary_rule "$access_cidr" 8443; rm -f "$state_file"
  run_logged "Nginx config test" nginx -t || return 1
  run_logged "Reload Nginx" systemctl reload nginx || return 1
  if ! ss -lnt 2>/dev/null | grep -Eq '(^|[[:space:]])(0\.0\.0\.0|\*):8443[[:space:]]|\[::\]:8443[[:space:]]'; then ok "دسترسی خارجی Supabase Studio بسته شد."; else fail "هنوز listener دیگری روی 8443 وجود دارد؛ بررسی لازم است."; ss -lntp | grep ':8443' | tee -a "$CURRENT_LOG" || true; return 1; fi
}

'''
text = text[:start] + block + text[end:]
path.write_text(text, encoding='utf-8')

path = Path('deploy/spark-cli/spark')
text = path.read_text(encoding='utf-8')
text = text.replace('SPARK_MANAGER_VERSION="2.0.0"', 'SPARK_MANAGER_VERSION="2.0.1"', 1)
old = "    admin-open) open_supabase_admin_access ;;\n    admin-close) close_supabase_admin_access ;;\n"
new = "    security-credentials) show_operator_credentials ;;\n    db-open) open_database_external_access ;;\n    db-close) close_database_external_access ;;\n    admin-open) open_supabase_admin_access ;;\n    admin-close) close_supabase_admin_access ;;\n"
if text.count(old) != 1: raise SystemExit('spark admin action anchor changed')
path.write_text(text.replace(old, new, 1), encoding='utf-8')

path = Path('deploy/spark-cli/spark-ui.py')
text = path.read_text(encoding='utf-8').replace('SPARK_UI_VERSION = "2.0.0"', 'SPARK_UI_VERSION = "2.0.1"', 1)
old = '''    ("Security", [
        Action("admin-open", "Open Supabase admin", "Create TLS/8443 gateway restricted to ADMIN_CIDR.", "confirm"),
        Action("admin-close", "Close Supabase admin", "Remove the temporary TLS/8443 admin gateway.", "controlled"),
        Action("diagnostic-exposure", "Public exposure check", "Verify DB/Kong/Supavisor ports are internal only."),
        Action("version-info", "Version & security", "Inspect runtime versions and repository state."),
    ]),
'''
new = '''    ("Security", [
        Action("security-credentials", "Show operator credentials", "Display the PostgreSQL and Supabase Studio credentials used by an operator on this server.", "controlled"),
        Action("db-open", "Open database access", "Publish PostgreSQL-compatible Supavisor on host TCP/5432 restricted to a selected CIDR.", "confirm"),
        Action("db-close", "Close database access", "Remove the external TCP/5432 mapping while keeping the local 127.0.0.1:5433 listener.", "controlled"),
        Action("admin-open", "Open Supabase Studio", "Create a validated TLS/8443 Studio gateway restricted to a selected CIDR.", "confirm"),
        Action("admin-close", "Close Supabase Studio", "Remove the temporary TLS/8443 Studio gateway and firewall rule.", "controlled"),
        Action("diagnostic-exposure", "Public exposure check", "Verify DB/Kong/Supavisor ports are internal unless intentionally opened."),
        Action("version-info", "Version & security", "Inspect runtime versions and repository state."),
    ]),
'''
if text.count(old) != 1: raise SystemExit('UI Security category anchor changed')
text = text.replace(old, new, 1)
old = '    status["admin"] = "OPEN" if re.search(r"(?:^|:)8443\\s", sockets, re.M) else "CLOSED"\n'
if text.count(old) != 1: raise SystemExit('UI admin status anchor changed')
text = text.replace(old, old + '    status["database"] = "OPEN" if re.search(r"(?:0\\.0\\.0\\.0|\\*|\\[::\\]):5432\\s", sockets, re.M) else "CLOSED"\n', 1)
old = '        summary = f" commit {commit}  |  install {self.status.get(\'steps\',\'0/20\')}  |  admin {self.status.get(\'admin\',\'CLOSED\')}  |  nginx {self.status.get(\'nginx\',\'?\')}  |  load {self.status.get(\'load\',\'?\')}  mem {self.status.get(\'memory\',\'?\')}  disk {self.status.get(\'disk\',\'?\')}"\n'
new = '        summary = f" commit {commit}  |  install {self.status.get(\'steps\',\'0/20\')}  |  db {self.status.get(\'database\',\'CLOSED\')}  studio {self.status.get(\'admin\',\'CLOSED\')}  |  nginx {self.status.get(\'nginx\',\'?\')}  |  load {self.status.get(\'load\',\'?\')}  mem {self.status.get(\'memory\',\'?\')}  disk {self.status.get(\'disk\',\'?\')}"\n'
if text.count(old) != 1: raise SystemExit('UI summary anchor changed')
text = text.replace(old, new, 1)
old = '        if action.action_id in ("admin-open", "admin-close"):\n            return self.status.get("admin", "")\n'
new = old + '        if action.action_id in ("db-open", "db-close"):\n            return self.status.get("database", "")\n'
if text.count(old) != 1: raise SystemExit('UI action status anchor changed')
text = text.replace(old, new, 1)
old = '        for label, value in [("Nginx", self.status.get("nginx", "?")), ("Coturn", self.status.get("coturn", "?")), ("Docker", self.status.get("docker", "?")), ("Admin 8443", self.status.get("admin", "?")), ("Install", self.status.get("steps", "?")), ("Backups", self.status.get("backups", "?")), ("Uptime", self.status.get("uptime", "?"))]:\n'
new = '        for label, value in [("Nginx", self.status.get("nginx", "?")), ("Coturn", self.status.get("coturn", "?")), ("Docker", self.status.get("docker", "?")), ("DB 5432", self.status.get("database", "?")), ("Studio 8443", self.status.get("admin", "?")), ("Install", self.status.get("steps", "?")), ("Backups", self.status.get("backups", "?")), ("Uptime", self.status.get("uptime", "?"))]:\n'
if text.count(old) != 1: raise SystemExit('UI details status anchor changed')
text = text.replace(old, new, 1)
text = text.replace('assert SPARK_UI_VERSION == "2.0.0"', 'assert SPARK_UI_VERSION == "2.0.1"', 1)
old = '    required = {"diagnostic-full", "app-update", "install-all", "manager-update", "admin-open"}\n'
new = '    required = {"diagnostic-full", "app-update", "install-all", "manager-update", "security-credentials", "db-open", "db-close", "admin-open", "admin-close"}\n'
if text.count(old) != 1: raise SystemExit('UI self-test action anchor changed')
path.write_text(text.replace(old, new, 1), encoding='utf-8')

path = Path('deploy/spark-cli/bootstrap.sh')
text = path.read_text(encoding='utf-8')
text = text.replace('EXPECTED_VERSION="2.0.0"', 'EXPECTED_VERSION="2.0.1"', 1)
text = text.replace('SPARK_MANAGER_VERSION="2.0.0"', 'SPARK_MANAGER_VERSION="2.0.1"', 1)
text = text.replace('SPARK_UI_VERSION = "2.0.0"', 'SPARK_UI_VERSION = "2.0.1"', 1)
path.write_text(text, encoding='utf-8')
PY

bash -n deploy/spark-cli/bootstrap.sh
bash -n deploy/spark-cli/spark
for f in deploy/spark-cli/lib/*.sh; do bash -n "$f"; done
python3 -m py_compile deploy/spark-cli/spark-ui.py
python3 deploy/spark-cli/spark-ui.py --self-test

grep -Fq 'security-credentials) show_operator_credentials' deploy/spark-cli/spark
grep -Fq 'db-open) open_database_external_access' deploy/spark-cli/spark
grep -Fq 'db-close) close_database_external_access' deploy/spark-cli/spark
grep -Fq '0.0.0.0:5432:5432/tcp' deploy/spark-cli/lib/admin.sh
grep -Fq 'curl -fsSkL' deploy/spark-cli/lib/admin.sh
grep -Fq 'DASHBOARD_PASSWORD' deploy/spark-cli/lib/admin.sh
grep -Fq 'POSTGRES_PASSWORD' deploy/spark-cli/lib/admin.sh

# Validate the compose patch algorithm against a fixture if PyYAML is present;
# install it for the validator only when the runner image lacks it.
python3 -c 'import yaml' >/dev/null 2>&1 || python3 -m pip install --user --quiet pyyaml
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
cat >"$fixture/docker-compose.yml" <<'YAML'
services:
  supavisor:
    image: example/supavisor
    ports:
      - 127.0.0.1:5433:5432/tcp
      - 127.0.0.1:6543:6543/tcp
YAML
SUPABASE_ROOT="$fixture" STATE_DIR="$fixture/state" CURRENT_LOG="$fixture/test.log" bash -c '
  set -Eeuo pipefail
  source deploy/spark-cli/lib/admin.sh
  patch_database_external_mapping open
  python3 - "$SUPABASE_ROOT/docker-compose.yml" <<"PY"
import sys,yaml
p=yaml.safe_load(open(sys.argv[1],encoding="utf-8"))["services"]["supavisor"]["ports"]
assert "127.0.0.1:5433:5432/tcp" in p
assert "0.0.0.0:5432:5432/tcp" in p
assert "127.0.0.1:6543:6543/tcp" in p
PY
  patch_database_external_mapping close
  python3 - "$SUPABASE_ROOT/docker-compose.yml" <<"PY"
import sys,yaml
p=yaml.safe_load(open(sys.argv[1],encoding="utf-8"))["services"]["supavisor"]["ports"]
assert "127.0.0.1:5433:5432/tcp" in p
assert "0.0.0.0:5432:5432/tcp" not in p
assert "127.0.0.1:6543:6543/tcp" in p
PY
'

git diff --check -- deploy/spark-cli/bootstrap.sh deploy/spark-cli/spark deploy/spark-cli/spark-ui.py deploy/spark-cli/lib/admin.sh

# Restore the registered CI exactly, then remove every temporary artifact.
git show "${ORIGINAL_CI_COMMIT}:.github/workflows/ci.yml" > .github/workflows/ci.yml
rm -f .github/workflows/tmp-spark-cli-access-fix.yml .spark-cli-access-fix-trigger .spark-cli-access-fix-runner.sh

git config user.name 'github-actions[bot]'
git config user.email '41898242+github-actions[bot]@users.noreply.github.com'
git add -- deploy/spark-cli/bootstrap.sh deploy/spark-cli/spark deploy/spark-cli/spark-ui.py deploy/spark-cli/lib/admin.sh .github/workflows/ci.yml .github/workflows/tmp-spark-cli-access-fix.yml .spark-cli-access-fix-trigger .spark-cli-access-fix-runner.sh
git diff --cached --check
git commit -m 'fix: make Spark CLI access controls operational [skip ci]'
git pull --rebase origin main
git push origin HEAD:main
