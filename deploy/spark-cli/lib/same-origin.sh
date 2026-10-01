# Same-origin Internet migration for Spark.
#
# Production frontend traffic must follow the hostname that served the page.
# The legacy API_DOMAIN endpoint remains available for compatibility, but the
# browser no longer depends on it. This module is loaded late from runtime-fixes
# so it overrides the legacy production env/build validation hooks.

spark_same_origin_patch_nginx_file() {
  local file="${1:-/etc/nginx/sites-available/spark}"
  [[ -f "$file" ]] || { fail "Nginx production config not found: $file"; return 1; }
  [[ -n "${APP_DOMAIN:-}" ]] || { fail "APP_DOMAIN is required for same-origin routing."; return 1; }

  APP_DOMAIN_ENV="$APP_DOMAIN" NGINX_FILE="$file" python3 - <<'PY'
import os
import re
from pathlib import Path

path = Path(os.environ["NGINX_FILE"])
app = os.environ["APP_DOMAIN_ENV"].strip()
text = path.read_text(encoding="utf-8")
marker = "# SPARK_SAME_ORIGIN_API_ROUTES"
if marker in text:
    raise SystemExit(0)

server_re = re.compile(r"\bserver\s*\{")
start = None
end = None
for match in server_re.finditer(text):
    i = match.start()
    depth = 0
    j = match.end() - 1
    while j < len(text):
        c = text[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                block = text[i:j+1]
                if re.search(rf"server_name\s+[^;]*\b{re.escape(app)}\b[^;]*;", block):
                    # Select the TLS frontend block, not the port-80 redirect block.
                    if re.search(r"\blisten\s+443\b", block) and "root /var/www/spark;" in block:
                        start, end = i, j + 1
                        break
                break
        j += 1
    if start is not None:
        break

if start is None or end is None:
    raise SystemExit(f"Unable to locate HTTPS frontend server block for {app}")

block = text[start:end]
spa = re.search(r"(?m)^\s*location\s+/\s*\{\s*\n\s*try_files\b", block)
if not spa:
    raise SystemExit("Unable to locate frontend SPA fallback location")

routes = r'''
    # SPARK_SAME_ORIGIN_API_ROUTES
    # Browser clients use window.location.origin. Keep Supabase APIs on the
    # same public hostname as the frontend while Kong remains loopback-only.
    location ^~ /realtime/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $spark_connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }

    location ^~ /functions/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location ~ ^/auth/v1/(token|signup|recover|otp|verify|resend)$ {
        limit_req zone=spark_auth_limit burst=30 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location ^~ /auth/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location ^~ /rest/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /storage/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /graphql/v1 {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

'''

insert_at = start + spa.start()
text = text[:insert_at] + routes + text[insert_at:]
path.write_text(text, encoding="utf-8")
PY
}

spark_same_origin_ensure_nginx() {
  local file=/etc/nginx/sites-available/spark backup=""
  [[ -f "$file" ]] || return 0

  if grep -Fq '# SPARK_SAME_ORIGIN_API_ROUTES' "$file"; then
    return 0
  fi

  backup="${file}.pre-same-origin-$(date +%Y%m%d%H%M%S)"
  cp -a "$file" "$backup" || return 1

  if ! spark_same_origin_patch_nginx_file "$file"; then
    cp -a "$backup" "$file"
    return 1
  fi
  if ! nginx -t >>"${CURRENT_LOG:-/dev/null}" 2>&1; then
    cp -a "$backup" "$file"
    nginx -t >>"${CURRENT_LOG:-/dev/null}" 2>&1 || true
    fail "Same-origin Nginx patch failed validation; previous config restored."
    return 1
  fi
  if ! systemctl reload nginx >>"${CURRENT_LOG:-/dev/null}" 2>&1; then
    cp -a "$backup" "$file"
    nginx -t >>"${CURRENT_LOG:-/dev/null}" 2>&1 && systemctl reload nginx >>"${CURRENT_LOG:-/dev/null}" 2>&1 || true
    fail "Same-origin Nginx reload failed; previous config restored."
    return 1
  fi
  ok "Same-origin Supabase routes enabled on ${APP_DOMAIN}."
}

prepare_frontend_production_env() {
  local root="$1" anon
  anon="$(env_get "${SUPABASE_ROOT}/.env" ANON_KEY)"
  [[ -n "$anon" ]] || { fail "ANON_KEY not available; frontend build stopped."; return 1; }
  [[ -n "${APP_DOMAIN:-}" ]] || { fail "APP_DOMAIN not set; frontend build stopped."; return 1; }

  # Direct import.meta.env.VITE_SUPABASE_URL references are replaced at build
  # time by vite.config.ts with window.location.origin. Keep the env value on the
  # current app origin for compatibility with any tooling that reads the file.
  env_set "${root}/.env.production" VITE_SUPABASE_URL "https://${APP_DOMAIN}"
  env_set "${root}/.env.production" VITE_SUPABASE_ANON_KEY "$anon"
  chmod 600 "${root}/.env.production"

  # Migration is additive: old API_DOMAIN remains available while the frontend
  # starts using same-origin API routes immediately.
  spark_same_origin_ensure_nginx || return 1
}

validate_frontend_production_build() {
  local root="$1"
  [[ -f "${root}/dist/index.html" ]] || {
    fail "Frontend build is missing dist/index.html."
    return 1
  }

  if [[ -n "${API_DOMAIN:-}" ]] && grep -R -F -q -- "https://${API_DOMAIN}" "${root}/dist"; then
    fail "Frontend build still contains legacy API hostname: https://${API_DOMAIN}"
    return 1
  fi
  if grep -R -F -q -- '%VITE_SUPABASE_URL%' "${root}/dist"; then
    fail "Frontend build still contains unresolved VITE_SUPABASE_URL placeholder."
    return 1
  fi

  # The production bundle must be capable of selecting the browser origin at
  # runtime; checking source config avoids requiring a specific DNS value in dist.
  grep -Fq "'import.meta.env.VITE_SUPABASE_URL': 'window.location.origin'" "${root}/vite.config.ts" || {
    fail "Production Vite config is not enforcing same-origin Supabase routing."
    return 1
  }
}

test_update_spark_validation() {
  require_manager_values || return 1
  echo "== Supabase local =="
  test_auth_health_url "http://127.0.0.1:8000/auth/v1/health" || return 1

  echo "== Frontend =="
  curl --noproxy '*' -fIsS --connect-timeout 5 --max-time 10 \
    --resolve "${APP_DOMAIN}:443:127.0.0.1" "https://${APP_DOMAIN}/" || return 1

  echo "== Same-origin API =="
  test_auth_health_url_resolved="$(curl --noproxy '*' -fsS --connect-timeout 5 --max-time 10 \
    --resolve "${APP_DOMAIN}:443:127.0.0.1" "https://${APP_DOMAIN}/auth/v1/health" 2>/dev/null || true)"
  [[ -n "$test_auth_health_url_resolved" ]] || return 1

  echo "== Docker =="
  compose ps || return 1
  echo "== Scheduler =="
  test_schedulers || return 1
}
