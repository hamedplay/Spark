# Final Studio HTTPS/443 proxy compatibility layer.
# Loaded after runtime-fixes.sh. Only the API-domain catch-all route is changed;
# REST/Auth/Storage/Functions routes keep their existing Host behavior.

studio_probe_code() {
  local url="$1" host_header="${2:-}" dashboard_user dashboard_password args=()
  dashboard_user="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_USERNAME)"
  dashboard_password="$(env_get "${SUPABASE_ROOT}/.env" DASHBOARD_PASSWORD)"
  dashboard_user="${dashboard_user:-supabase}"
  [[ -n "$dashboard_password" ]] || { printf '000'; return 1; }
  [[ -n "$host_header" ]] && args+=( -H "Host: ${host_header}" )
  curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 12 \
    -u "${dashboard_user}:${dashboard_password}" "${args[@]}" "$url" 2>/dev/null || printf '000'
}

studio_proxy_patch_external_host() {
  API_DOMAIN_ENV="$API_DOMAIN" python3 - <<'PY'
from pathlib import Path
import os
p=Path('/etc/nginx/sites-available/spark')
s=p.read_text(encoding='utf-8')
needle='''    location / {\n        proxy_pass http://127.0.0.1:8000;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection $spark_connection_upgrade;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_read_timeout 3600s;\n    }\n}\n'''
replacement='''    location / {\n        proxy_pass http://127.0.0.1:8000;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection $spark_connection_upgrade;\n        proxy_set_header Host 127.0.0.1:8000;\n        proxy_set_header X-Forwarded-Host $host;\n        proxy_set_header X-Forwarded-Port 443;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_read_timeout 3600s;\n    }\n}\n'''
pos=s.rfind(needle)
if pos < 0:
    raise SystemExit('Enabled Studio catch-all block not found; refusing to patch another Nginx route')
s=s[:pos]+replacement+s[pos+len(needle):]
p.write_text(s, encoding='utf-8')
PY
}

# Override only application of the Studio state. runtime-fixes.sh still owns
# generation of the enabled/disabled root route and all other API locations.
apply_studio_access_state() {
  cleanup_retired_studio_8443
  write_nginx_production || return 1
  if studio_access_enabled; then
    studio_proxy_patch_external_host || return 1
  fi
  run_logged "Nginx config test" nginx -t || return 1
  run_logged "Reload Nginx" systemctl reload nginx || return 1
}

# Add explicit per-hop diagnostics around the existing Studio enable flow.
eval "$(declare -f open_supabase_studio_access | sed '1s/open_supabase_studio_access/open_supabase_studio_access_base/')"
open_supabase_studio_access() {
  local code_direct code_host code_https
  code_direct="$(studio_probe_code 'http://127.0.0.1:8000/')"
  code_host="$(studio_probe_code 'http://127.0.0.1:8000/' "$API_DOMAIN")"
  info "Studio probe قبل از Enable: Envoy-direct=${code_direct} Envoy-Host(${API_DOMAIN})=${code_host}"

  if ! open_supabase_studio_access_base; then
    code_https="$(studio_probe_code "https://${API_DOMAIN}/")"
    warn "Studio probe بعد از failure: HTTPS/443=${code_https}"
    return 1
  fi

  code_https="$(studio_probe_code "https://${API_DOMAIN}/")"
  info "Studio probe نهایی: HTTPS/443=${code_https}"
  [[ "$code_https" =~ ^2[0-9][0-9]$|^3[0-9][0-9]$ ]] || {
    fail "Studio روی HTTPS/443 بعد از Enable پاسخ معتبر نداد (HTTP ${code_https})."
    return 1
  }
}
