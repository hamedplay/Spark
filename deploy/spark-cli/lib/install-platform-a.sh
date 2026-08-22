patch_compose() {
  local compose_file="${SUPABASE_ROOT}/docker-compose.yml"
  COMPOSE_FILE="$compose_file" SPARK_ROOT_ENV="$SPARK_ROOT" python3 - <<'PY'
import os,sys,yaml
from pathlib import Path

path=Path(os.environ["COMPOSE_FILE"])
data=yaml.safe_load(path.read_text(encoding="utf-8"))
if not isinstance(data,dict) or not isinstance(data.get("services"),dict):
    raise SystemExit("docker-compose.yml has no services mapping")
services=data["services"]
required=["api-gw","db","supavisor","auth","functions"]
missing=[x for x in required if x not in services]
if missing:
    raise SystemExit(f"Refusing to guess service names. Missing: {missing}")

services["api-gw"]["ports"]=["127.0.0.1:8000:8000/tcp"]
services["db"].pop("ports",None)
services["supavisor"]["ports"]=[
    "127.0.0.1:5433:5432/tcp",
    "127.0.0.1:6543:6543/tcp",
]

def env_to_dict(v):
    if v is None: return {}
    if isinstance(v,dict): return dict(v)
    if isinstance(v,list):
        out={}
        for item in v:
            if isinstance(item,str):
                if "=" in item:
                    k,val=item.split("=",1); out[k]=val
                else:
                    out[item]=None
            elif isinstance(item,dict):
                out.update(item)
        return out
    raise SystemExit("Unsupported environment format")

auth_env=env_to_dict(services["auth"].get("environment"))
auth_env.update({
    "GOTRUE_HOOK_SEND_SMS_ENABLED":"true",
    "GOTRUE_HOOK_SEND_SMS_URI":"http://functions:9000/auth-send-sms-hook",
    "GOTRUE_HOOK_SEND_SMS_SECRETS":"${SEND_SMS_HOOK_SECRET}",
})
services["auth"]["environment"]=auth_env

fn=services["functions"]
env_file=fn.get("env_file",[])
if isinstance(env_file,str): env_file=[env_file]
elif env_file is None: env_file=[]
elif not isinstance(env_file,list): raise SystemExit("Unsupported functions env_file format")
if "/etc/spark/functions-extra.env" not in env_file:
    env_file.append("/etc/spark/functions-extra.env")
fn["env_file"]=env_file
fn_env=env_to_dict(fn.get("environment"))
for key in [
    "SEND_SMS_HOOK_SECRET","PHONE_RATE_LIMIT_PEPPER","PHONE_PASSWORD_RESET_SECRET",
    "PHONE_LOGIN_ALLOWED_ORIGINS","DAILY_REPORT_CRON_SECRET",
    "NOTIFICATION_OUTBOX_CRON_SECRET","MINUTES_REMINDER_CRON_SECRET",
    "DECISION_DUE_CRON_SECRET",
]:
    fn_env[key]="${"+key+"}"
fn["environment"]=fn_env

services["avatar-worker"]={
    "build":{
        "context":os.path.join(os.environ["SPARK_ROOT_ENV"],"worker"),
        "dockerfile":"Dockerfile",
    },
    "restart":"unless-stopped",
    "env_file":["/etc/spark/avatar-worker.env"],
    "depends_on":{"api-gw":{"condition":"service_healthy"}},
    "read_only":True,
    "tmpfs":["/tmp:size=64m,mode=1777"],
    "security_opt":["no-new-privileges:true"],
    "cap_drop":["ALL"],
}

path.write_text(yaml.safe_dump(data,sort_keys=False,default_flow_style=False),encoding="utf-8")
PY
}

test_compose_security() {
  local rendered rc=0
  rendered="$(mktemp)"
  (cd "$SUPABASE_ROOT" && docker compose config >"$rendered") || rc=$?
  if (( rc != 0 )); then
    rm -f "$rendered"
    return "$rc"
  fi
  if python3 - "$rendered" <<'PY'
import sys,yaml
d=yaml.safe_load(open(sys.argv[1],encoding="utf-8"))
s=d["services"]
def ports(name):
    return s[name].get("ports") or []
def published(p):
    if isinstance(p,str): return p
    if isinstance(p,dict):
        return f'{p.get("host_ip","")}:{p.get("published","")}:{p.get("target","")}'
    return str(p)
kp=[published(x) for x in ports("api-gw")]
sp=[published(x) for x in ports("supavisor")]
dp=[published(x) for x in ports("db")]
assert any("127.0.0.1" in p and "8000" in p for p in kp), kp
assert all("0.0.0.0" not in p and "[::]" not in p for p in kp), kp
assert all("5432" not in p for p in dp), dp
assert any("127.0.0.1" in p and "5433" in p for p in sp), sp
assert any("127.0.0.1" in p and "6543" in p for p in sp), sp
assert "avatar-worker" in s
PY
  then
    rc=0
  else
    rc=$?
  fi
  rm -f "$rendered"
  return "$rc"
}

install_step_10() {
  title
  new_log "install-10-compose"
  require_file "${SUPABASE_ROOT}/docker-compose.yml" || return 1
  require_file "${CONFIG_DIR}/functions-extra.env" || return 1
  require_file "${CONFIG_DIR}/avatar-worker.env" || return 1
  local backup="${SUPABASE_ROOT}/docker-compose.yml.before-spark"
  local safety="${SUPABASE_ROOT}/docker-compose.yml.pre-manager-$(date +%Y%m%d%H%M%S)"
  cp -a "${SUPABASE_ROOT}/docker-compose.yml" "$safety"
  [[ -f "$backup" ]] || cp -a "${SUPABASE_ROOT}/docker-compose.yml" "$backup"

  if ! run_logged "اعمال تغییرات کنترل‌شده Docker Compose" patch_compose; then
    cp -a "$safety" "${SUPABASE_ROOT}/docker-compose.yml"
    return 1
  fi
  if ! run_logged "docker compose config" bash -c "cd '$SUPABASE_ROOT' && docker compose config --quiet"; then
    warn "Compose نامعتبر شد؛ فایل قبلی restore شد."
    cp -a "$safety" "${SUPABASE_ROOT}/docker-compose.yml"
    return 1
  fi
  if run_logged "تست bindهای Loopback و Avatar Worker" test_compose_security; then
    rm -f "$safety"
    mark_step 10
  else
    warn "Security validation شکست خورد؛ فایل قبلی restore شد."
    cp -a "$safety" "${SUPABASE_ROOT}/docker-compose.yml"
    rm -f "$safety"
    unmark_step 10
    return 1
  fi
}

supabase_db_password_preflight() {
  (cd "$SUPABASE_ROOT" && docker compose exec -T db sh -lc \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U postgres -d "$POSTGRES_DB" -Atqc "select 1"' 2>&1 | grep -qx '1')
}

repair_supabase_bootstrap() {
  local has_internal_db
  has_internal_db="$(cd "$SUPABASE_ROOT" && docker compose exec -T db psql -U postgres -d postgres -Atqc "select 1 from pg_database where datname='_supabase'" 2>/dev/null || true)"

  # Official roles.sql is safe to replay and synchronizes all service-role
  # passwords with the active POSTGRES_PASSWORD after an interrupted bootstrap.
  (cd "$SUPABASE_ROOT" && docker compose exec -T db sh -lc \
    'psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /docker-entrypoint-initdb.d/init-scripts/99-roles.sql') || return 1

  # _supabase is created by the official 97-_supabase.sql migration and is
  # required by Supavisor. Only replay creation when the database is absent.
  if [[ "$has_internal_db" != "1" ]]; then
    (cd "$SUPABASE_ROOT" && docker compose exec -T db sh -lc \
      'psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /docker-entrypoint-initdb.d/migrations/97-_supabase.sql') || return 1
  fi

  # pooler.sql is idempotent once _supabase exists (CREATE SCHEMA IF NOT EXISTS).
  (cd "$SUPABASE_ROOT" && docker compose exec -T db sh -lc \
    'psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /docker-entrypoint-initdb.d/migrations/99-pooler.sql') || return 1
}

supabase_bootstrap_ready() {
  (cd "$SUPABASE_ROOT" && docker compose exec -T db psql -U postgres -d postgres -Atqc \
    "select case when exists(select 1 from pg_database where datname='_supabase') and exists(select 1 from pg_roles where rolname='supabase_storage_admin') and exists(select 1 from pg_roles where rolname='supabase_auth_admin') and exists(select 1 from pg_roles where rolname='authenticator') then 1 else 0 end" 2>/dev/null | grep -qx 1)
}

supabase_service_state() {
  local service="$1"
  (cd "$SUPABASE_ROOT" && docker compose ps --format json "$service" 2>/dev/null) | python3 -c '
import json,sys
raw=sys.stdin.read().strip()
if not raw:
    raise SystemExit(1)
try:
    value=json.loads(raw)
except json.JSONDecodeError:
    value=json.loads(raw.splitlines()[-1])
if isinstance(value,list):
    value=value[0] if value else {}
state=str(value.get("State","")).lower()
health=str(value.get("Health","")).lower()
print(state + ("/"+health if health else ""))
'
}

supabase_core_ready() {
  local service state anon
  for service in db api-gw auth rest realtime storage supavisor functions; do
    state="$(supabase_service_state "$service" 2>/dev/null || true)"
    [[ "$state" == running* ]] || return 1
    [[ "$state" != *unhealthy* ]] || return 1
    [[ "$state" != *restarting* ]] || return 1
  done
  anon="$(env_get "${SUPABASE_ROOT}/.env" ANON_KEY)"
  [[ -n "$anon" ]] || return 1
  curl -fsS --connect-timeout 5 -H "apikey: $anon" -H "Authorization: Bearer $anon" \
    http://127.0.0.1:8000/auth/v1/health >/dev/null || return 1
}

report_supabase_start_failure() {
  local service
  printf '\nSupabase startup diagnostics\n' | tee -a "$CURRENT_LOG"
  printf '%s\n' '----------------------------------------' | tee -a "$CURRENT_LOG"
  (cd "$SUPABASE_ROOT" && docker compose ps) 2>&1 | tee -a "$CURRENT_LOG" || true
  for service in auth rest realtime storage supavisor api-gw functions avatar-worker; do
    printf '\n--- %s (last 80 log lines) ---\n' "$service" | tee -a "$CURRENT_LOG"
    (cd "$SUPABASE_ROOT" && docker compose logs --no-color --tail=80 "$service") 2>&1 | tee -a "$CURRENT_LOG" || true
  done
}

test_supabase_health() {
  supabase_core_ready
}

install_step_11() {
  title
  new_log "install-11-supabase-start"
  run_logged "Validate Docker Compose" bash -c "cd '$SUPABASE_ROOT' && docker compose config --quiet" || return 1
  run_logged "Pull imageهای Supabase" bash -c "cd '$SUPABASE_ROOT' && docker compose pull" || return 1
  run_logged "Build Avatar Worker" bash -c "cd '$SUPABASE_ROOT' && docker compose build --no-cache avatar-worker" || return 1

  run_logged "Start Supabase database preflight" bash -c "cd '$SUPABASE_ROOT' && docker compose up -d db" || return 1
  local db_deadline=$((SECONDS + 60))
  while (( SECONDS < db_deadline )); do
    if [[ "$(supabase_service_state db 2>/dev/null || true)" == running/healthy ]]; then
      break
    fi
    sleep 2
  done
  if ! run_logged "Verify configured PostgreSQL password against active database" supabase_db_password_preflight; then
    fail "Database volume با POSTGRES_PASSWORD فعلی سازگار نیست. برای ایمنی هیچ data volume ای حذف یا reset نشد."
    run_visible "Database status" bash -c "cd '$SUPABASE_ROOT' && docker compose ps db" || true
    run_visible "Database logs" bash -c "cd '$SUPABASE_ROOT' && docker compose logs --no-color --tail=80 db" || true
    unmark_step 11
    return 1
  fi

  if ! supabase_bootstrap_ready; then
    warn "Bootstrap داخلی Supabase ناقص است؛ فقط init scriptهای رسمی لازم برای service roles و Supavisor بازپخش می‌شوند."
    run_logged "Repair interrupted Supabase bootstrap" repair_supabase_bootstrap || {
      unmark_step 11
      return 1
    }
  else
    # Even on a complete bootstrap, synchronize service-role passwords with the
    # configured secret. This is safe and avoids stale role credentials.
    run_logged "Synchronize Supabase service-role passwords" repair_supabase_bootstrap || {
      unmark_step 11
      return 1
    }
  fi
  run_logged "Validate Supabase internal bootstrap" supabase_bootstrap_ready || {
    unmark_step 11
    return 1
  }

  run_logged "Start Supabase stack" bash -c "cd '$SUPABASE_ROOT' && docker compose up -d" || return 1
  info "منتظر آماده‌شدن سرویس‌های اصلی Supabase (حداکثر ۹۰ ثانیه)..."
  local deadline=$((SECONDS + 90))
  while (( SECONDS < deadline )); do
    if supabase_core_ready; then
      mark_step 11
      ok "سرویس‌های اصلی Supabase آماده هستند."
      return 0
    fi
    sleep 3
  done

  unmark_step 11
  warn "Supabase در مهلت readiness آماده نشد؛ وضعیت و log سرویس‌های مشکل‌دار ثبت می‌شود."
  report_supabase_start_failure
  return 1
}

migration_dry_run() {
  local root="${1:-$SPARK_ROOT}" url
  url="$(db_url)"
  (cd "$root" && npx --yes supabase@latest db push --db-url "$url" --dry-run)
}

migration_apply() {
  local root="${1:-$SPARK_ROOT}" url
  url="$(db_url)"
  (cd "$root" && npx --yes supabase@latest db push --db-url "$url" --include-all)
}

test_frontend_deploy() {
  require_file "${SPARK_ROOT}/dist/index.html" || return 1
  require_file "/var/www/spark/index.html" || return 1
  nginx -t || return 1
}

install_step_13() {
  title
  new_log "install-13-frontend"
  require_manager_values || return 1
  local anon
  anon="$(env_get "${SUPABASE_ROOT}/.env" ANON_KEY)"
  [[ -n "$anon" ]] || { fail "ANON_KEY موجود نیست."; return 1; }
  env_set "${SPARK_ROOT}/.env.production" VITE_SUPABASE_URL "https://${API_DOMAIN}"
  env_set "${SPARK_ROOT}/.env.production" VITE_SUPABASE_ANON_KEY "$anon"
  chmod 600 "${SPARK_ROOT}/.env.production"
  run_logged "npm ci" bash -c "cd '$SPARK_ROOT' && npm ci" || return 1
  run_logged "Production build" bash -c "cd '$SPARK_ROOT' && npm run build" || return 1
  mkdir -p /var/www/spark /var/www/acme
  run_logged "Deploy frontend به /var/www/spark" rsync -a --delete "${SPARK_ROOT}/dist/" /var/www/spark/ || return 1
  run_logged "تنظیم ownership وب" chown -R www-data:www-data /var/www/spark /var/www/acme || return 1
  if run_logged "تست Frontend artifact و Nginx syntax" test_frontend_deploy; then
    mark_step 13
  else
    unmark_step 13
    return 1
  fi
}
