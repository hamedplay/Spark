# Studio session layer loaded after runtime-fixes.sh.
# Keep the official Dashboard Basic Auth credentials, but terminate the browser
# challenge at Nginx once and use a short-lived secure session cookie afterwards.

STUDIO_SESSION_TOKEN_FILE="${CONFIG_DIR}/studio-session.token"
STUDIO_HTPASSWD_FILE="/etc/nginx/.spark-studio.htpasswd"
STUDIO_SESSION_MAX_AGE=28800

ensure_studio_session_material() {
  local dashboard_user dashboard_password token hash
  dashboard_user="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_USERNAME)"
  dashboard_password="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_PASSWORD)"
  dashboard_user="${dashboard_user:-supabase}"
  [[ -n "$dashboard_password" ]] || {
    fail "DASHBOARD_PASSWORD برای Studio پیدا نشد."
    return 1
  }

  mkdir -p "$CONFIG_DIR"
  token="$(cat "$STUDIO_SESSION_TOKEN_FILE" 2>/dev/null || true)"
  if [[ ! "$token" =~ ^[A-Fa-f0-9]{64}$ ]]; then
    token="$(openssl rand -hex 32)" || return 1
    printf '%s\n' "$token" >"$STUDIO_SESSION_TOKEN_FILE"
  fi
  chmod 600 "$STUDIO_SESSION_TOKEN_FILE"

  hash="$(printf '%s\n' "$dashboard_password" | openssl passwd -apr1 -stdin)" || return 1
  printf '%s:%s\n' "$dashboard_user" "$hash" >"$STUDIO_HTPASSWD_FILE"
  chown root:www-data "$STUDIO_HTPASSWD_FILE" 2>/dev/null || true
  chmod 640 "$STUDIO_HTPASSWD_FILE"
}

remove_studio_session_material() {
  rm -f "$STUDIO_SESSION_TOKEN_FILE" "$STUDIO_HTPASSWD_FILE"
}

studio_session_configured() {
  [[ -s "$STUDIO_SESSION_TOKEN_FILE" ]] || return 1
  [[ -s "$STUDIO_HTPASSWD_FILE" ]] || return 1
  grep -q 'spark_studio_session' /etc/nginx/sites-available/spark 2>/dev/null || return 1
}

# runtime-fixes.sh already generates the correct Studio catch-all and keeps all
# Supabase API routes unchanged. Add browser-session auth only to that catch-all.
eval "$(declare -f write_nginx_production | sed '1s/write_nginx_production/write_nginx_production_session_base/')"
write_nginx_production() {
  write_nginx_production_session_base || return 1
  studio_access_enabled || return 0
  ensure_studio_session_material || return 1

  local dashboard_user dashboard_password token upstream_basic
  dashboard_user="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_USERNAME)"
  dashboard_password="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_PASSWORD)"
  dashboard_user="${dashboard_user:-supabase}"
  token="$(cat "$STUDIO_SESSION_TOKEN_FILE")"
  upstream_basic="$(printf '%s:%s' "$dashboard_user" "$dashboard_password" | base64 -w0)"

  STUDIO_TOKEN_ENV="$token" STUDIO_BASIC_ENV="$upstream_basic" STUDIO_MAX_AGE_ENV="$STUDIO_SESSION_MAX_AGE" python3 - <<'PY'
from pathlib import Path
import os

p=Path('/etc/nginx/sites-available/spark')
s=p.read_text(encoding='utf-8')
token=os.environ['STUDIO_TOKEN_ENV']
basic=os.environ['STUDIO_BASIC_ENV']
max_age=os.environ['STUDIO_MAX_AGE_ENV']

session_map=f'''map $cookie_spark_studio_session $spark_studio_auth_realm {{\n    default "Spark Studio";\n    "{token}" off;\n}}\n\n'''
if 'map $cookie_spark_studio_session $spark_studio_auth_realm' not in s:
    s=session_map+s

old='''    location / {\n        proxy_pass http://127.0.0.1:8000;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection $spark_connection_upgrade;\n        proxy_set_header Host 127.0.0.1:8000;\n        proxy_set_header X-Forwarded-Host $host;\n        proxy_set_header X-Forwarded-Port 443;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_read_timeout 3600s;\n    }\n}\n'''
new=f'''    location / {{\n        auth_basic $spark_studio_auth_realm;\n        auth_basic_user_file /etc/nginx/.spark-studio.htpasswd;\n        add_header Set-Cookie "spark_studio_session={token}; Path=/; Max-Age={max_age}; Secure; HttpOnly; SameSite=Strict";\n\n        proxy_pass http://127.0.0.1:8000;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection $spark_connection_upgrade;\n        proxy_set_header Host 127.0.0.1:8000;\n        proxy_set_header X-Forwarded-Host $host;\n        proxy_set_header X-Forwarded-Port 443;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header Authorization "Basic {basic}";\n        proxy_read_timeout 3600s;\n    }}\n}}\n'''
pos=s.rfind(old)
if pos < 0:
    raise SystemExit('Studio catch-all block not found; refusing to modify other Nginx routes')
s=s[:pos]+new+s[pos+len(old):]
p.write_text(s,encoding='utf-8')
PY
  chmod 600 /etc/nginx/sites-available/spark
}

# Treat legacy enabled configurations as needing one repair pass so selecting
# Enable after Manager Update installs the session boundary automatically.
eval "$(declare -f studio_external_is_open | sed '1s/studio_external_is_open/studio_external_is_open_session_base/')"
studio_external_is_open() {
  studio_session_configured || return 1
  studio_external_is_open_session_base
}

# Disabling Studio invalidates every browser session by deleting the server-side
# token and htpasswd material after the route has been closed.
eval "$(declare -f close_supabase_studio_access | sed '1s/close_supabase_studio_access/close_supabase_studio_access_session_base/')"
close_supabase_studio_access() {
  close_supabase_studio_access_session_base || return 1
  remove_studio_session_material
  ok "Sessionهای قبلی Supabase Studio باطل شدند."
}
