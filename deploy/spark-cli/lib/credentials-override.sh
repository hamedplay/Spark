# Exact operator connection details loaded after admin.sh.

show_database_connection_info() {
  local file="${SUPABASE_ROOT}/.env"
  local password tenant username public_ip state db_name

  external_access_requirements || return 1
  password="$(env_get "$file" POSTGRES_PASSWORD)"
  tenant="$(env_get "$file" POOLER_TENANT_ID)"
  db_name="$(env_get "$file" POSTGRES_DB)"
  db_name="${db_name:-postgres}"
  public_ip="${TURN_PUBLIC_IP:-}"
  state="$(database_security_state)"

  [[ -n "$password" ]] || { fail "POSTGRES_PASSWORD در ${file} خالی یا موجود نیست."; return 1; }
  [[ -n "$tenant" ]] || { fail "POOLER_TENANT_ID در ${file} خالی یا موجود نیست."; return 1; }
  username="postgres.${tenant}"

  printf '\n%s%spgAdmin / PostgreSQL%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
  printf '%s\n' '============================================================'
  printf 'Public connection\n'
  printf 'Host     : %s\n' "${public_ip:-<server-public-ip>}"
  printf 'Port     : 5432\n'
  printf 'Database : %s\n' "$db_name"
  printf 'Username : %s\n' "$username"
  printf 'Password : %s\n' "$password"
  printf 'SSL Mode : Disable\n'
  printf 'State    : %s\n' "$state"
  printf '\nSSH tunnel / local connection\n'
  printf 'Host     : 127.0.0.1\n'
  printf 'Port     : 5433\n'
  printf 'Database : %s\n' "$db_name"
  printf 'Username : %s\n' "$username"
  printf 'Password : %s\n' "$password"
  printf '============================================================\n'
  info "Password مستقیماً از POSTGRES_PASSWORD و Username از postgres.<POOLER_TENANT_ID> ساخته شده است."
}

show_studio_connection_info() {
  local file="${SUPABASE_ROOT}/.env"
  local dashboard_user dashboard_password state

  external_access_requirements || return 1
  dashboard_user="$(env_get "$file" DASHBOARD_USERNAME)"
  dashboard_password="$(env_get "$file" DASHBOARD_PASSWORD)"
  dashboard_user="${dashboard_user:-supabase}"
  [[ -n "$dashboard_password" ]] || { fail "DASHBOARD_PASSWORD در ${file} خالی یا موجود نیست."; return 1; }
  state="CLOSED"
  studio_external_is_open && state="OPEN"

  printf '\n%s%sSupabase Studio / Dashboard%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
  printf '%s\n' '============================================================'
  printf 'URL      : https://%s:8443\n' "$API_DOMAIN"
  printf 'Username : %s\n' "$dashboard_user"
  printf 'Password : %s\n' "$dashboard_password"
  printf 'State    : %s\n' "$state"
  printf '============================================================\n'
  info "Username/Password مستقیماً از DASHBOARD_USERNAME و DASHBOARD_PASSWORD خوانده شده‌اند."
}
