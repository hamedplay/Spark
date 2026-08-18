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
required=["kong","db","supavisor","auth","functions"]
missing=[x for x in required if x not in services]
if missing:
    raise SystemExit(f"Refusing to guess service names. Missing: {missing}")

services["kong"]["ports"]=["127.0.0.1:8000:8000/tcp"]
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
    "depends_on":{"kong":{"condition":"service_healthy"}},
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
kp=[published(x) for x in ports("kong")]
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

test_supabase_health() {
  compose ps || return 1
  curl -fsS --connect-timeout 5 http://127.0.0.1:8000/auth/v1/health || return 1
}

install_step_11() {
  title
  new_log "install-11-supabase-start"
  run_logged "Validate Docker Compose" bash -c "cd '$SUPABASE_ROOT' && docker compose config --quiet" || return 1
  run_logged "Pull imageهای Supabase" bash -c "cd '$SUPABASE_ROOT' && docker compose pull" || return 1
  run_logged "Build Avatar Worker" bash -c "cd '$SUPABASE_ROOT' && docker compose build avatar-worker" || return 1
  run_logged "Start Supabase" bash -c "cd '$SUPABASE_ROOT' && docker compose up -d" || return 1
  info "منتظر آماده‌شدن سرویس‌ها..."
  sleep 12
  if run_logged "Health check Supabase" test_supabase_health; then
    mark_step 11
  else
    unmark_step 11
    run_visible "Docker service status" compose ps || true
    return 1
  fi
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

install_step_12() {
  title
  new_log "install-12-migrations"
  require_dir "${SPARK_ROOT}/supabase/migrations" || return 1
  require_file "${SUPABASE_ROOT}/.env" || return 1
  run_visible "Migration dry-run" migration_dry_run "$SPARK_ROOT" || return 1
  if ! confirm_word "Dry-run بالا را بررسی کنید. اعمال migrationها ممکن است schema/data را تغییر دهد." "APPLY"; then
    warn "اعمال migration لغو شد."
    return 1
  fi
  run_logged "اعمال migrationهای Spark" migration_apply "$SPARK_ROOT" || return 1
  if run_logged "Dry-run پس از اعمال" migration_dry_run "$SPARK_ROOT"; then
    mark_step 12
  else
    unmark_step 12
    return 1
  fi
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
