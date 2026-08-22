load_config() {
  if [[ -f "$MANAGER_CONF" ]]; then
    source "$MANAGER_CONF"
  fi
}

save_config() {
  umask 077
  local tmp
  tmp="$(mktemp)"
  {
    printf 'APP_DOMAIN=%q\n' "${APP_DOMAIN:-}"
    printf 'WWW_DOMAIN=%q\n' "${WWW_DOMAIN:-}"
    printf 'API_DOMAIN=%q\n' "${API_DOMAIN:-}"
    printf 'TURN_DOMAIN=%q\n' "${TURN_DOMAIN:-}"
    printf 'TURN_PUBLIC_IP=%q\n' "${TURN_PUBLIC_IP:-}"
    printf 'TURN_PRIVATE_IP=%q\n' "${TURN_PRIVATE_IP:-}"
    printf 'LE_EMAIL=%q\n' "${LE_EMAIL:-}"
    printf 'TURN_MIN_PORT=%q\n' "${TURN_MIN_PORT:-49160}"
    printf 'TURN_MAX_PORT=%q\n' "${TURN_MAX_PORT:-49200}"
    printf 'SUPABASE_REF=%q\n' "${SUPABASE_REF:-}"
    printf 'SUPABASE_COMMIT=%q\n' "${SUPABASE_COMMIT:-}"
  } >"$tmp"
  install -m 0600 "$tmp" "$MANAGER_CONF"
  rm -f "$tmp"
}

load_config
[[ -f "$MANAGER_CONF" ]] && save_config

pause() {
  printf '\n'
  read -r -p "برای ادامه Enter بزنید..." _
}

clear_screen() {
  command -v clear >/dev/null 2>&1 && clear || printf '\033c'
}

title() {
  clear_screen
  printf '%s%sSpark Server Manager%s  v%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET" "$SPARK_MANAGER_VERSION"
  printf '%s%s%s\n\n' "$C_BLUE" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "$C_RESET"
}

ok() { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fail() { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*"; }
info() { printf '%s•%s %s\n' "$C_CYAN" "$C_RESET" "$*"; }

new_log() {
  local name="${1//[^A-Za-z0-9_.-]/_}"
  CURRENT_LOG="${LOG_DIR}/$(date +%Y%m%d-%H%M%S)-${name}.log"
  : >"$CURRENT_LOG"
  chmod 600 "$CURRENT_LOG"
}

show_failure_log() {
  local log="${1:-$CURRENT_LOG}"
  [[ -f "$log" ]] || return 0
  printf '\n%sآخرین خروجی خطا:%s\n' "$C_RED" "$C_RESET"
  tail -n 80 "$log" || true
  printf '\nLog: %s\n' "$log"
}

run_logged() {
  local label="$1"
  shift
  info "$label"
  if "$@" >>"$CURRENT_LOG" 2>&1; then
    ok "$label"
    return 0
  fi
  fail "$label"
  show_failure_log "$CURRENT_LOG"
  return 1
}

run_visible() {
  local label="$1"
  shift
  info "$label"
  set +e
  "$@" 2>&1 | tee -a "$CURRENT_LOG"
  local rc=${PIPESTATUS[0]}
  set -e
  if (( rc == 0 )); then
    ok "$label"
  else
    fail "$label"
  fi
  return "$rc"
}

run_report() {
  local label="$1"
  shift
  info "$label"
  set +e
  "$@" 2>&1 | tee -a "$CURRENT_LOG"
  local rc=${PIPESTATUS[0]}
  set -e
  if (( rc == 0 )); then
    ok "$label"
  else
    warn "$label نتیجه هشدار/یافته دارد (exit=$rc)"
  fi
  return 0
}

mark_step() {
  local step="$1"
  printf '%s\n' "$(date -Is)" >"${STEP_DIR}/${step}.ok"
  chmod 600 "${STEP_DIR}/${step}.ok"
}

unmark_step() {
  rm -f "${STEP_DIR}/${1}.ok"
}

step_badge() {
  if [[ -f "${STEP_DIR}/${1}.ok" ]]; then
    printf '%s[✓]%s' "$C_GREEN" "$C_RESET"
  else
    printf '[ ]'
  fi
}

installation_step_name() {
  case "$1" in
    2) printf 'Configuration' ;;
    3) printf 'Base packages / Docker / Node' ;;
    4) printf 'Spark repository' ;;
    5) printf 'Supabase source pin' ;;
    6) printf 'Supabase secrets' ;;
    7) printf 'Supabase environment' ;;
    8) printf 'Edge Functions sync' ;;
    9) printf 'Provider / worker environment' ;;
    10) printf 'Docker Compose' ;;
    11) printf 'Supabase runtime' ;;
    12) printf 'Database migrations' ;;
    13) printf 'Frontend deployment' ;;
    14) printf 'Nginx bootstrap / web server' ;;
    15) printf 'TLS certificates' ;;
    16) printf 'Production Nginx' ;;
    17) printf 'Schedulers' ;;
    18) printf 'TURN / Coturn' ;;
    19) printf 'Certbot renewal' ;;
    20) printf 'Firewall / UFW' ;;
    *) return 1 ;;
  esac
}

installation_migrations_current() {
  local local_versions remote_versions pending
  [[ -d "${SPARK_ROOT}/supabase/migrations" ]] || return 1
  [[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] || return 1

  local_versions="$(find "${SPARK_ROOT}/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' \
    | sed -nE 's/^([0-9]{14})_.*/\1/p' | sort -u)"
  [[ -n "$local_versions" ]] || return 1

  remote_versions="$(compose exec -T db psql -U postgres -d postgres -Atqc \
    'select version from supabase_migrations.schema_migrations order by version;' 2>/dev/null \
    | tr -d '\r' | sort -u)" || return 1

  pending="$(comm -23 \
    <(printf '%s\n' "$local_versions") \
    <(printf '%s\n' "$remote_versions"))"
  [[ -z "$pending" ]]
}

installation_nginx_present() {
  command -v nginx >/dev/null 2>&1 || return 1
  nginx -t >/dev/null 2>&1 || return 1
  systemctl is-active --quiet nginx || return 1
  [[ -L /etc/nginx/sites-enabled/spark || -L /etc/nginx/sites-enabled/spark-bootstrap ]]
}

installation_step_probe() {
  case "$1" in
    2) test_values ;;
    3) test_base_packages ;;
    4) test_spark_repo ;;
    5) test_supabase_source ;;
    6) test_supabase_secrets ;;
    7) test_supabase_env ;;
    8) test_function_sync ;;
    9) test_provider_env ;;
    10) test_compose_security ;;
    11) test_supabase_health ;;
    12) installation_migrations_current ;;
    13) test_frontend_deploy ;;
    14) installation_nginx_present ;;
    15) test_certificates ;;
    16) test_nginx_production ;;
    17) test_schedulers ;;
    18) test_turn ;;
    19) test_certbot_hook ;;
    20) test_firewall ;;
    *) return 1 ;;
  esac
}

installation_status_report() {
  local n name actual history formatted
  local installed=() missing=()

  [[ -n "${CURRENT_LOG:-}" ]] || new_log "installation-status"

  printf 'Spark installation status — actual server probe\n'
  printf '%s\n' '----------------------------------------------------------------------------'
  printf '%-4s %-15s %-9s %s\n' 'No.' 'Actual' 'History' 'Component'
  printf '%s\n' '----------------------------------------------------------------------------'

  for n in $(seq 2 20); do
    printf -v formatted '%02d' "$n"
    name="$(installation_step_name "$n")"

    if installation_step_probe "$n" >/dev/null 2>&1; then
      actual='INSTALLED'
      installed+=("$formatted")
    else
      actual='NOT INSTALLED'
      missing+=("$formatted")
    fi

    if [[ -f "${STEP_DIR}/${n}.ok" ]]; then
      history='DONE'
    else
      history='-'
    fi

    printf '%-4s %-15s %-9s %s\n' "$formatted" "$actual" "$history" "$name"
  done

  printf '%s\n' '----------------------------------------------------------------------------'
  printf 'Installed     : %s\n' "${installed[*]:-none}"
  printf 'Not installed : %s\n' "${missing[*]:-none}"
  printf 'Total         : %d/19\n' "${#installed[@]}"
  printf '\nActual = وضعیت واقعی همین سرور. History = این مرحله قبلاً توسط Manager با موفقیت ثبت شده است.\n'
}

confirm_word() {
  local message="$1" word="$2" answer
  printf '%s\n' "$message"
  read -r -p "برای تأیید عبارت ${word} را وارد کنید: " answer
  [[ "$answer" == "$word" ]]
}

prompt_default() {
  local var_name="$1" prompt="$2" default="${3:-}" value
  if [[ -n "$default" ]]; then
    read -r -p "${prompt} [${default}]: " value
    value="${value:-$default}"
  else
    read -r -p "${prompt}: " value
  fi
  printf -v "$var_name" '%s' "$value"
}

valid_ipv4() {
  python3 - "$1" <<'PY'
import ipaddress,sys
try:
    ip=ipaddress.ip_address(sys.argv[1])
    raise SystemExit(0 if ip.version == 4 else 1)
except ValueError:
    raise SystemExit(1)
PY
}

valid_domain() {
  [[ "$1" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]]
}

valid_email() {
  [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

require_file() {
  [[ -f "$1" ]] || { echo "Required file missing: $1" >>"$CURRENT_LOG"; return 1; }
}

require_dir() {
  [[ -d "$1" ]] || { echo "Required directory missing: $1" >>"$CURRENT_LOG"; return 1; }
}

ensure_values() {
  local changed=0
  if [[ -z "${APP_DOMAIN:-}" ]]; then APP_DOMAIN="shahrmeeting.ir"; changed=1; fi
  if [[ -z "${WWW_DOMAIN:-}" ]]; then WWW_DOMAIN="www.${APP_DOMAIN}"; changed=1; fi
  if [[ -z "${API_DOMAIN:-}" ]]; then API_DOMAIN="api.${APP_DOMAIN}"; changed=1; fi
  if [[ -z "${TURN_DOMAIN:-}" ]]; then TURN_DOMAIN="turn.${APP_DOMAIN}"; changed=1; fi
  if [[ -z "${TURN_MIN_PORT:-}" ]]; then TURN_MIN_PORT="49160"; changed=1; fi
  if [[ -z "${TURN_MAX_PORT:-}" ]]; then TURN_MAX_PORT="49200"; changed=1; fi
  (( changed )) && save_config
}

configure_values_interactive() {
  ensure_values
  local v
  while true; do
    prompt_default v "دامنه اصلی" "${APP_DOMAIN:-shahrmeeting.ir}"
    valid_domain "$v" && { APP_DOMAIN="$v"; break; }
    fail "دامنه معتبر نیست."
  done
  while true; do
    prompt_default v "دامنه www" "${WWW_DOMAIN:-www.$APP_DOMAIN}"
    valid_domain "$v" && { WWW_DOMAIN="$v"; break; }
    fail "دامنه معتبر نیست."
  done
  while true; do
    prompt_default v "دامنه API" "${API_DOMAIN:-api.$APP_DOMAIN}"
    valid_domain "$v" && { API_DOMAIN="$v"; break; }
    fail "دامنه معتبر نیست."
  done
  while true; do
    prompt_default v "دامنه TURN" "${TURN_DOMAIN:-turn.$APP_DOMAIN}"
    valid_domain "$v" && { TURN_DOMAIN="$v"; break; }
    fail "دامنه معتبر نیست."
  done
  while true; do
    prompt_default v "Public IPv4 سرور" "${TURN_PUBLIC_IP:-}"
    valid_ipv4 "$v" && { TURN_PUBLIC_IP="$v"; break; }
    fail "IPv4 معتبر نیست."
  done
  while true; do
    prompt_default v "Private IPv4 سرور (اگر NAT ندارید همان Public IP)" "${TURN_PRIVATE_IP:-$TURN_PUBLIC_IP}"
    valid_ipv4 "$v" && { TURN_PRIVATE_IP="$v"; break; }
    fail "IPv4 معتبر نیست."
  done
  while true; do
    prompt_default v "Email برای Let's Encrypt" "${LE_EMAIL:-}"
    valid_email "$v" && { LE_EMAIL="$v"; break; }
    fail "Email معتبر نیست."
  done
  prompt_default TURN_MIN_PORT "TURN minimum relay port" "${TURN_MIN_PORT:-49160}"
  prompt_default TURN_MAX_PORT "TURN maximum relay port" "${TURN_MAX_PORT:-49200}"
  [[ "$TURN_MIN_PORT" =~ ^[0-9]+$ && "$TURN_MAX_PORT" =~ ^[0-9]+$ ]] || {
    fail "پورت TURN باید عددی باشد."
    return 1
  }
  (( TURN_MIN_PORT < TURN_MAX_PORT && TURN_MIN_PORT >= 1024 && TURN_MAX_PORT <= 65535 )) || {
    fail "بازه TURN نامعتبر است."
    return 1
  }
  save_config
  ok "تنظیمات در ${MANAGER_CONF} ذخیره شد (mode 600)."
}

env_get() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  python3 - "$file" "$key" <<'PY'
import sys
path,key=sys.argv[1:3]
value=""
for raw in open(path, encoding="utf-8"):
    line=raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k,v=line.split("=",1)
    if k.strip()==key:
        value=v.strip().strip('"').strip("'")
        break
print(value)
PY
}

env_set() {
  local file="$1" key="$2" value="$3"
  FILE="$file" KEY="$key" VALUE="$value" python3 - <<'PY'
import os
from pathlib import Path
path=Path(os.environ["FILE"])
key=os.environ["KEY"]
value=os.environ["VALUE"]
lines=path.read_text(encoding="utf-8").splitlines() if path.exists() else []
out=[]
replaced=False
for line in lines:
    stripped=line.lstrip()
    if stripped and not stripped.startswith("#") and "=" in stripped and stripped.split("=",1)[0].strip()==key:
        if not replaced:
            out.append(f"{key}={value}")
            replaced=True
        continue
    out.append(line)
if not replaced:
    if out and out[-1] != "":
        out.append("")
    out.append(f"{key}={value}")
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text("\n".join(out)+"\n", encoding="utf-8")
PY
}

env_has_nonempty() {
  [[ -n "$(env_get "$1" "$2")" ]]
}

require_manager_values() {
  local missing=()
  local key
  for key in APP_DOMAIN WWW_DOMAIN API_DOMAIN TURN_DOMAIN TURN_PUBLIC_IP TURN_PRIVATE_IP LE_EMAIL TURN_MIN_PORT TURN_MAX_PORT; do
    [[ -n "${!key:-}" ]] || missing+=("$key")
  done
  if ((${#missing[@]})); then
    fail "این مقادیر تنظیم نشده‌اند: ${missing[*]}"
    info "ابتدا مرحله 2 نصب را اجرا کنید."
    return 1
  fi
}


install_manager_from_dir() {
  local source_dir="$1"
  local stage backup module
  [[ -f "${source_dir}/spark" ]] || { fail "Spark Manager entrypoint پیدا نشد: ${source_dir}/spark"; return 1; }
  for module in core install-base install-platform-a install-platform-b install-platform-c tests-backup update admin; do
    [[ -f "${source_dir}/lib/${module}.sh" ]] || { fail "Spark Manager module پیدا نشد: ${module}.sh"; return 1; }
  done
  bash -n "${source_dir}/spark" || return 1
  for module in "${source_dir}"/lib/*.sh; do bash -n "$module" || return 1; done

  install -d -m 0755 /usr/local/lib
  stage="$(mktemp -d /usr/local/lib/spark-manager.new.XXXXXX)"
  backup="/usr/local/lib/spark-manager.previous.$$"
  install -d -m 0755 "${stage}/lib"
  install -m 0755 "${source_dir}/spark" "${stage}/spark"
  for module in "${source_dir}"/lib/*.sh; do install -m 0644 "$module" "${stage}/lib/$(basename "$module")"; done

  if [[ -d /usr/local/lib/spark-manager ]]; then
    mv /usr/local/lib/spark-manager "$backup"
  fi
  if ! mv "$stage" /usr/local/lib/spark-manager; then
    [[ -d "$backup" ]] && mv "$backup" /usr/local/lib/spark-manager
    rm -rf "$stage"
    return 1
  fi
  ln -sfn /usr/local/lib/spark-manager/spark "$CLI_PATH"
  rm -rf "$backup"
}

compose() {
  docker compose -f "${SUPABASE_ROOT}/docker-compose.yml" "$@"
}

db_password_encoded() {
  local password
  password="$(env_get "${SUPABASE_ROOT}/.env" POSTGRES_PASSWORD)"
  [[ -n "$password" ]] || return 1
  PASSWORD="$password" python3 - <<'PY'
import os,urllib.parse
print(urllib.parse.quote(os.environ["PASSWORD"], safe=""))
PY
}

db_url() {
  local encoded
  encoded="$(db_password_encoded)" || return 1
  printf 'postgresql://postgres:%s@127.0.0.1:5433/postgres\n' "$encoded"
}
