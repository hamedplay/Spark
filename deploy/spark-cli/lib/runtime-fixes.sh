# Late runtime fixes loaded after repair-override + env-modern.

STUDIO_ACCESS_FLAG="${CONFIG_DIR}/studio-access.enabled"

# -----------------------------------------------------------------------------
# Supabase Studio: share the existing API HTTPS vhost on 443.
# Enabling/disabling Studio controls only the API-domain root route; API service
# prefixes remain available on 443 in both states.
# -----------------------------------------------------------------------------

studio_access_enabled() {
  [[ -f "$STUDIO_ACCESS_FLAG" ]]
}

studio_external_is_open() {
  studio_access_enabled || return 1
  [[ -L /etc/nginx/sites-enabled/spark ]] || return 1
  ss -lnt 2>/dev/null | grep -Eq '(^|[[:space:]])(0\.0\.0\.0|\*|\[::\]):443[[:space:]]' || return 1
  local dashboard_user dashboard_password
  dashboard_user="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_USERNAME)"
  dashboard_password="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_PASSWORD)"
  dashboard_user="${dashboard_user:-supabase}"
  [[ -n "$dashboard_password" ]] || return 1
  curl -fsSkL --connect-timeout 3 --max-time 10 --resolve "${API_DOMAIN}:443:127.0.0.1" \
    -u "${dashboard_user}:${dashboard_password}" "https://${API_DOMAIN}/" -o /dev/null 2>&1
}

show_studio_connection_info() {
  local dashboard_user dashboard_password state
  external_access_requirements || return 1
  dashboard_user="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_USERNAME)"
  dashboard_password="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_PASSWORD)"
  dashboard_user="${dashboard_user:-supabase}"
  [[ -n "$dashboard_password" ]] || { fail "DASHBOARD_PASSWORD پیدا نشد."; return 1; }
  state="DISABLED"; studio_external_is_open && state="ENABLED / VERIFIED"
  printf '\n%s%sSupabase Studio access%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
  printf '%s\n' '────────────────────────────────────────────────────────────'
  printf 'State    : %s\n' "$state"
  printf 'URL      : https://%s\n' "$API_DOMAIN"
  printf 'Port     : 443\n'
  printf 'Username : %s\n' "$dashboard_user"
  printf 'Password : %s\n' "$dashboard_password"
  printf '%s\n' '────────────────────────────────────────────────────────────'
  if ! studio_access_enabled; then
    warn "Studio access غیرفعال است؛ APIهای Supabase روی HTTPS/443 فعال باقی می‌مانند."
  fi
}

# Replace only the API-domain root behavior of the generated production config.
# The base function still owns certificates and all API route definitions.
eval "$(declare -f write_nginx_production | sed '1s/write_nginx_production/write_nginx_production_base/')"
write_nginx_production() {
  write_nginx_production_base || return 1
  STUDIO_ENABLED_ENV=0
  studio_access_enabled && STUDIO_ENABLED_ENV=1
  STUDIO_ENABLED_ENV="$STUDIO_ENABLED_ENV" python3 - <<'PY'
from pathlib import Path
import os
p=Path('/etc/nginx/sites-available/spark')
s=p.read_text(encoding='utf-8')
old='''    location / {\n        return 404;\n    }\n}\n'''
if os.environ.get('STUDIO_ENABLED_ENV') == '1':
    new='''    location / {\n        proxy_pass http://127.0.0.1:8000;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection $spark_connection_upgrade;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_read_timeout 3600s;\n    }\n}\n'''
else:
    new=old
pos=s.rfind(old)
if pos < 0:
    raise SystemExit('API-domain catch-all location not found; refusing to guess')
s=s[:pos]+new+s[pos+len(old):]
p.write_text(s, encoding='utf-8')
PY
}

cleanup_retired_studio_8443() {
  rm -f /etc/nginx/sites-enabled/spark-supabase-admin /etc/nginx/sites-available/spark-supabase-admin
  firewall_optional_close_port 8443
}

apply_studio_access_state() {
  cleanup_retired_studio_8443
  write_nginx_production || return 1
  run_logged "Nginx config test" nginx -t || return 1
  run_logged "Reload Nginx" systemctl reload nginx || return 1
}

open_supabase_studio_access() {
  external_access_requirements || return 1
  [[ -e /etc/nginx/sites-enabled/spark ]] || {
    fail "Production Nginx فعال نیست؛ ابتدا مرحله Production Nginx را اجرا کنید."
    return 1
  }
  if studio_external_is_open; then
    ok "Supabase Studio از قبل روی HTTPS/443 فعال و پاسخ آن تأیید شده است."
    show_studio_connection_info
    return 0
  fi
  if ! confirm_word "دسترسی Supabase Studio روی https://${API_DOMAIN} (HTTPS/443) فعال می‌شود. APIهای Supabase بدون تغییر باقی می‌مانند." "OPEN"; then
    warn "لغو شد."
    return 1
  fi

  mkdir -p "$CONFIG_DIR"
  : >"$STUDIO_ACCESS_FLAG"
  chmod 600 "$STUDIO_ACCESS_FLAG"
  if ! apply_studio_access_state; then
    rm -f "$STUDIO_ACCESS_FLAG"
    apply_studio_access_state >/dev/null 2>&1 || true
    fail "فعال‌سازی Studio شکست خورد و state قبلی restore شد."
    return 1
  fi

  local dashboard_user dashboard_password
  dashboard_user="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_USERNAME)"
  dashboard_password="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_PASSWORD)"
  dashboard_user="${dashboard_user:-supabase}"
  [[ -n "$dashboard_password" ]] || { fail "DASHBOARD_PASSWORD موجود نیست."; return 1; }
  if ! curl -fsSkL --connect-timeout 5 --max-time 15 --resolve "${API_DOMAIN}:443:127.0.0.1" \
      -u "${dashboard_user}:${dashboard_password}" "https://${API_DOMAIN}/" -o /dev/null; then
    rm -f "$STUDIO_ACCESS_FLAG"
    apply_studio_access_state >/dev/null 2>&1 || true
    fail "Studio روی HTTPS/443 پاسخ معتبر نداد؛ دسترسی دوباره غیرفعال شد."
    return 1
  fi
  ok "Supabase Studio روی HTTPS/443 فعال و پاسخ آن تأیید شد."
  show_studio_connection_info
}

close_supabase_studio_access() {
  external_access_requirements || return 1
  rm -f "$STUDIO_ACCESS_FLAG"
  if ! apply_studio_access_state; then
    fail "غیرفعال‌سازی Studio در Nginx اعمال نشد."
    return 1
  fi
  if curl -fsSk --connect-timeout 3 --max-time 8 --resolve "${API_DOMAIN}:443:127.0.0.1" \
      "https://${API_DOMAIN}/" -o /dev/null 2>/dev/null; then
    fail "Root route دامنه API هنوز پاسخ موفق می‌دهد؛ Studio access بسته نشده است."
    return 1
  fi
  ok "دسترسی Supabase Studio روی HTTPS/443 غیرفعال شد؛ REST/Auth/Storage/Functions روی 443 فعال باقی ماندند."
}

security_status_report() {
  local db_state studio_state tenant username
  db_state="$(database_security_state)"
  studio_state="DISABLED"; studio_external_is_open && studio_state="ENABLED / VERIFIED"
  tenant="$(pooler_tenant_id)"; username="$(database_pooler_username 2>/dev/null || true)"
  printf '\n%s%sSecurity access status%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
  printf '%s\n' '────────────────────────────────────────────────────────────'
  printf 'Database        : %s\n' "$db_state"
  printf 'Pooler tenant   : %s\n' "${tenant:-MISSING}"
  printf 'Pooler username : %s\n' "${username:-MISSING}"
  printf 'Studio HTTPS/443: %s\n' "$studio_state"
  if ufw_is_active; then
    printf '\nUFW:\n'
    ufw status numbered
  else
    printf '\nUFW: inactive\n'
  fi
}

# Override the Security Center labels/actions so no retired 8443 semantics remain.
open_supabase_admin_access() {
  local choice db_state studio_state
  while true; do
    clear_screen
    db_state="$(database_security_state)"
    studio_state="DISABLED"; studio_external_is_open && studio_state="ENABLED"
    printf '%s%sSecurity Center%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
    printf '%s\n' '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    printf 'Database : %-24s  Studio/443 : %s\n\n' "$db_state" "$studio_state"
    printf '0) بازگشت\n'
    printf '1) اطلاعات اتصال PostgreSQL / pgAdmin\n'
    printf '2) تست واقعی Login دیتابیس (Local Supavisor)\n'
    printf '3) باز کردن Database روی TCP/5432\n'
    printf '4) بستن Database روی TCP/5432\n'
    printf '5) اطلاعات اتصال Supabase Studio\n'
    printf '6) فعال‌کردن دسترسی Supabase Studio روی HTTPS/443\n'
    printf '7) غیرفعال‌کردن دسترسی Supabase Studio روی HTTPS/443\n'
    printf '8) گزارش وضعیت Security / Firewall\n\n'
    read -r -p "انتخاب: " choice
    case "$choice" in
      0) return 0 ;;
      1) show_database_connection_info || true; security_access_wait ;;
      2) new_log "database-login-test"; if run_visible "PostgreSQL login through local Supavisor" database_pooler_login_test 5433; then ok "Login واقعی دیتابیس موفق است."; fi; security_access_wait ;;
      3) new_log "database-access-open"; open_database_external_access || true; security_access_wait ;;
      4) new_log "database-access-close"; close_database_external_access || true; security_access_wait ;;
      5) show_studio_connection_info || true; security_access_wait ;;
      6) new_log "supabase-studio-open"; open_supabase_studio_access || true; security_access_wait ;;
      7) new_log "supabase-studio-close"; close_supabase_studio_access || true; security_access_wait ;;
      8) security_status_report; security_access_wait ;;
      *) fail "گزینه نامعتبر"; sleep 1 ;;
    esac
  done
}

close_supabase_admin_access() {
  new_log "supabase-studio-close"
  close_supabase_studio_access
}

# -----------------------------------------------------------------------------
# Storage DB-role repair.
# storage-api connects as supabase_storage_admin and SET ROLEs to JWT roles.
# Restore the official role memberships if an existing DB missed bootstrap grants.
# -----------------------------------------------------------------------------

eval "$(declare -f repair_supabase_bootstrap | sed '1s/repair_supabase_bootstrap/repair_supabase_bootstrap_base/')"
repair_supabase_bootstrap() {
  repair_supabase_bootstrap_base || return 1
  (cd "$SUPABASE_ROOT" && docker compose exec -T db psql \
    -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
GRANT anon, authenticated, service_role TO supabase_storage_admin;
SQL
  ) || return 1
}

eval "$(declare -f supabase_bootstrap_ready | sed '1s/supabase_bootstrap_ready/supabase_bootstrap_ready_base/')"
supabase_bootstrap_ready() {
  supabase_bootstrap_ready_base || return 1
  (cd "$SUPABASE_ROOT" && docker compose exec -T db psql -U postgres -d postgres -Atqc \
    "select case when
       pg_has_role('supabase_storage_admin','anon','MEMBER')
       and pg_has_role('supabase_storage_admin','authenticated','MEMBER')
       and pg_has_role('supabase_storage_admin','service_role','MEMBER')
     then 1 else 0 end" 2>/dev/null | grep -qx 1)
}
