# Late runtime fixes loaded after repair-override + env-modern.

# -----------------------------------------------------------------------------
# Supabase Studio: use the existing API HTTPS vhost on 443, not a separate 8443.
# Envoy already protects the Studio routes with DASHBOARD_USERNAME/PASSWORD.
# -----------------------------------------------------------------------------

studio_external_is_open() {
  [[ -L /etc/nginx/sites-enabled/spark ]] || return 1
  ss -lnt 2>/dev/null | grep -Eq '(^|[[:space:]])(0\.0\.0\.0|\*|\[::\]):443[[:space:]]' || return 1
  curl -fsSkI --connect-timeout 3 --max-time 8 --resolve "${API_DOMAIN}:443:127.0.0.1" \
    "https://${API_DOMAIN}/" >/dev/null 2>&1 || return 1
}

show_studio_connection_info() {
  local dashboard_user dashboard_password state
  external_access_requirements || return 1
  dashboard_user="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_USERNAME)"
  dashboard_password="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_PASSWORD)"
  dashboard_user="${dashboard_user:-supabase}"
  [[ -n "$dashboard_password" ]] || { fail "DASHBOARD_PASSWORD پیدا نشد."; return 1; }
  state="CLOSED"; studio_external_is_open && state="OPEN"
  printf '\n%s%sSupabase Studio access%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
  printf '%s\n' '────────────────────────────────────────────────────────────'
  printf 'State    : %s\n' "$state"
  printf 'URL      : https://%s\n' "$API_DOMAIN"
  printf 'Port     : 443\n'
  printf 'Username : %s\n' "$dashboard_user"
  printf 'Password : %s\n' "$dashboard_password"
  printf '%s\n' '────────────────────────────────────────────────────────────'
}

# Replace only the API-domain root behavior of the generated production config.
# The base function still owns certificates and all API route definitions.
eval "$(declare -f write_nginx_production | sed '1s/write_nginx_production/write_nginx_production_base/')"
write_nginx_production() {
  write_nginx_production_base || return 1
  python3 - <<'PY'
from pathlib import Path
p=Path('/etc/nginx/sites-available/spark')
s=p.read_text(encoding='utf-8')
old='''    location / {\n        return 404;\n    }\n}\n'''
new='''    location / {\n        proxy_pass http://127.0.0.1:8000;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection $spark_connection_upgrade;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_read_timeout 3600s;\n    }\n}\n'''
# Only replace the final API vhost catch-all; fail closed if structure changed.
pos=s.rfind(old)
if pos < 0:
    raise SystemExit('API-domain catch-all location not found; refusing to guess')
s=s[:pos]+new+s[pos+len(old):]
p.write_text(s, encoding='utf-8')
PY
}

open_supabase_studio_access() {
  external_access_requirements || return 1
  [[ -e /etc/nginx/sites-enabled/spark ]] || {
    fail "Production Nginx فعال نیست؛ ابتدا مرحله Production Nginx را اجرا کنید."
    return 1
  }

  # Remove the retired 8443 vhost/rule if it exists from an older manager.
  rm -f /etc/nginx/sites-enabled/spark-supabase-admin /etc/nginx/sites-available/spark-supabase-admin
  firewall_optional_close_port 8443

  if ! write_nginx_production; then
    fail "Production Nginx برای Studio روی 443 بازسازی نشد."
    return 1
  fi
  run_logged "Nginx config test" nginx -t || return 1
  run_logged "Reload Nginx" systemctl reload nginx || return 1

  local dashboard_user dashboard_password
  dashboard_user="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_USERNAME)"
  dashboard_password="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_PASSWORD)"
  dashboard_user="${dashboard_user:-supabase}"
  [[ -n "$dashboard_password" ]] || { fail "DASHBOARD_PASSWORD موجود نیست."; return 1; }

  if ! curl -fsSkL --connect-timeout 5 --max-time 15 --resolve "${API_DOMAIN}:443:127.0.0.1" \
      -u "${dashboard_user}:${dashboard_password}" "https://${API_DOMAIN}/" -o /dev/null; then
    fail "Studio روی HTTPS/443 پاسخ معتبر نداد."
    return 1
  fi
  ok "Supabase Studio روی HTTPS/443 فعال و پاسخ آن تأیید شد."
  show_studio_connection_info
}

close_supabase_studio_access() {
  warn "Studio دیگر listener مستقل ندارد؛ روی همان API HTTPS/443 سرو می‌شود."
  info "بستن 443 باعث قطع REST/Auth/Storage/Functions هم می‌شود، بنابراین از Security Center جداگانه بسته نمی‌شود."
  return 0
}

security_status_report() {
  local db_state studio_state tenant username
  db_state="$(database_security_state)"
  studio_state="CLOSED"; studio_external_is_open && studio_state="OPEN"
  tenant="$(pooler_tenant_id)"; username="$(database_pooler_username 2>/dev/null || true)"
  printf '\n%s%sSecurity access status%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
  printf '%s\n' '────────────────────────────────────────────────────────────'
  printf 'Database       : %s\n' "$db_state"
  printf 'Pooler tenant  : %s\n' "${tenant:-MISSING}"
  printf 'Pooler username: %s\n' "${username:-MISSING}"
  printf 'Studio HTTPS/443: %s\n' "$studio_state"
  if ufw_is_active; then
    printf '\nUFW:\n'
    ufw status numbered
  else
    printf '\nUFW: inactive\n'
  fi
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
