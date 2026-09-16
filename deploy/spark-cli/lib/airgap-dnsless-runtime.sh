# DNS-free runtime enforcement for the internal-IP Air-Gap deployment.
# Loaded after airgap-ip.sh. This module does not change the normal online
# installer; it tightens only the offline IP-only runtime contract.

# Preserve the IP-mode implementations that we intentionally extend.
eval "$(declare -f test_supabase_env | sed '1s/test_supabase_env/test_supabase_env_dnsless_base/')"
eval "$(declare -f install_step_6 | sed '1s/install_step_6/install_step_6_dnsless_base/')"
eval "$(declare -f patch_compose | sed '1s/patch_compose/patch_compose_dnsless_base/')"
eval "$(declare -f test_compose_security | sed '1s/test_compose_security/test_compose_security_dnsless_base/')"
eval "$(declare -f test_frontend_deploy | sed '1s/test_frontend_deploy/test_frontend_deploy_dnsless_base/')"

airgap_dnsless_forbidden_runtime_pattern() {
  printf '%s\n' '(^|[^A-Za-z0-9.-])([A-Za-z0-9-]+\.)*shahrmeeting\.ir([^A-Za-z0-9.-]|$)'
}

airgap_dnsless_file_has_legacy_domain() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  grep -Eqi "$(airgap_dnsless_forbidden_runtime_pattern)" "$file"
}

airgap_dnsless_tree_has_legacy_domain() {
  local root="$1"
  [[ -d "$root" ]] || return 1
  grep -RIlE --include='*.html' --include='*.js' --include='*.mjs' --include='*.css' --include='*.json' \
    "$(airgap_dnsless_forbidden_runtime_pattern)" "$root" 2>/dev/null | grep -q .
}

# Let the inherited Step 06 perform all of its normal normalization first.
# Air-Gap IP mode overrides the generic environment step, so explicitly restore
# the intended GoTrue provider policy here: existing email/password users must
# be able to sign in while direct public GoTrue sign-up remains disabled.
install_step_6() {
  local SPARK_DNSLESS_BASE_ENV_VALIDATION=1
  install_step_6_dnsless_base || return 1

  env_set "${SUPABASE_ROOT}/.env" PUBLIC_API_BASE_URL "$(airgap_ip_base_url)"
  env_set "${SUPABASE_ROOT}/.env" ENABLE_EMAIL_SIGNUP "true"
  env_set "${SUPABASE_ROOT}/.env" DISABLE_SIGNUP "true"
  chmod 600 "${SUPABASE_ROOT}/.env"
  SPARK_DNSLESS_BASE_ENV_VALIDATION=0

  if run_logged "Validate DNS-free Supabase runtime environment" test_supabase_env; then
    mark_step 6
  else
    unmark_step 6
    return 1
  fi
}

test_supabase_env() {
  test_supabase_env_dnsless_base || return 1
  [[ "${SPARK_DNSLESS_BASE_ENV_VALIDATION:-0}" == "1" ]] && return 0

  local file="${SUPABASE_ROOT}/.env" base key value
  base="$(airgap_ip_base_url)"
  [[ "$(env_get "$file" PUBLIC_API_BASE_URL)" == "$base" ]] || return 1
  [[ "$(env_get "$file" ENABLE_EMAIL_SIGNUP)" == "true" ]] || {
    printf 'Air-Gap GoTrue email provider must be enabled (ENABLE_EMAIL_SIGNUP=true).\n' >>"$CURRENT_LOG"
    return 1
  }
  [[ "$(env_get "$file" DISABLE_SIGNUP)" == "true" ]] || {
    printf 'Air-Gap direct public GoTrue signup must remain disabled (DISABLE_SIGNUP=true).\n' >>"$CURRENT_LOG"
    return 1
  }

  for key in \
    SUPABASE_PUBLIC_URL API_EXTERNAL_URL SITE_URL ADDITIONAL_REDIRECT_URLS \
    PHONE_LOGIN_ALLOWED_ORIGINS PUBLIC_API_BASE_URL PROXY_DOMAIN; do
    value="$(env_get "$file" "$key")"
    [[ -n "$value" ]] || return 1
    if grep -Eqi "$(airgap_dnsless_forbidden_runtime_pattern)" <<<"$value"; then
      printf 'Legacy DNS value remains in %s=%s\n' "$key" "$value" >>"$CURRENT_LOG"
      return 1
    fi
  done
}

# Compose is target-specific after import, so inject the selected IPv4 origin
# directly into Functions and normalize GoTrue URLs/provider policy. This keeps
# every internal callback on HTTP/IP and prevents the upstream example defaults
# from silently disabling email/password login.
patch_compose() {
  patch_compose_dnsless_base || return 1
  COMPOSE_FILE="${SUPABASE_ROOT}/docker-compose.yml" \
    AIRGAP_BASE_URL="$(airgap_ip_base_url)" \
    python3 - <<'PY'
import os
from pathlib import Path
import yaml

p = Path(os.environ['COMPOSE_FILE'])
doc = yaml.safe_load(p.read_text(encoding='utf-8'))
services = doc.get('services') if isinstance(doc, dict) else None
if not isinstance(services, dict) or 'functions' not in services or 'auth' not in services:
    raise SystemExit('docker-compose.yml is missing functions/auth service')

value = os.environ['AIRGAP_BASE_URL']

def envdict(raw):
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, list):
        out = {}
        for item in raw:
            text = str(item)
            if '=' in text:
                k, v = text.split('=', 1)
                out[k] = v
            else:
                out[text] = None
        return out
    raise SystemExit('service environment has an unsupported Compose shape')

functions_env = envdict(services['functions'].get('environment'))
functions_env['PUBLIC_API_BASE_URL'] = value
services['functions']['environment'] = functions_env

auth_env = envdict(services['auth'].get('environment'))
auth_env['GOTRUE_EXTERNAL_EMAIL_ENABLED'] = '${ENABLE_EMAIL_SIGNUP}'
auth_env['GOTRUE_DISABLE_SIGNUP'] = '${DISABLE_SIGNUP}'
auth_env['GOTRUE_HOOK_SEND_SMS_URI'] = f'{value}/functions/v1/auth-send-sms-hook'
services['auth']['environment'] = auth_env

p.write_text(yaml.safe_dump(doc, sort_keys=False, default_flow_style=False), encoding='utf-8')
PY
}

test_compose_security() {
  test_compose_security_dnsless_base || return 1
  local rendered rc=0
  rendered="$(mktemp)"
  (cd "$SUPABASE_ROOT" && docker compose config >"$rendered") || rc=$?
  if (( rc != 0 )); then
    rm -f "$rendered"
    return "$rc"
  fi

  AIRGAP_BASE_URL="$(airgap_ip_base_url)" python3 - "$rendered" <<'PY' || rc=$?
import os
import re
import sys
import yaml

path = sys.argv[1]
text = open(path, encoding='utf-8').read()
if re.search(r'(^|[^A-Za-z0-9.-])(?:[A-Za-z0-9-]+\.)*shahrmeeting\.ir(?:[^A-Za-z0-9.-]|$)', text, re.I | re.M):
    raise SystemExit('rendered Compose still contains a shahrmeeting.ir runtime dependency')

doc = yaml.safe_load(text)
expected = os.environ['AIRGAP_BASE_URL']

def envdict(raw):
    if isinstance(raw, dict):
        return raw
    out = {}
    for item in raw or []:
        item = str(item)
        if '=' in item:
            k, v = item.split('=', 1)
            out[k] = v
    return out

functions_env = envdict(doc['services']['functions'].get('environment'))
auth_env = envdict(doc['services']['auth'].get('environment'))

if functions_env.get('PUBLIC_API_BASE_URL') != expected:
    raise SystemExit(f"functions PUBLIC_API_BASE_URL is not {expected!r}: {functions_env.get('PUBLIC_API_BASE_URL')!r}")
if str(auth_env.get('GOTRUE_EXTERNAL_EMAIL_ENABLED', '')).lower() != 'true':
    raise SystemExit('GoTrue email/password provider is disabled in rendered Compose')
if str(auth_env.get('GOTRUE_DISABLE_SIGNUP', '')).lower() != 'true':
    raise SystemExit('GoTrue direct public signup is not disabled in rendered Compose')
expected_sms = f'{expected}/functions/v1/auth-send-sms-hook'
if auth_env.get('GOTRUE_HOOK_SEND_SMS_URI') != expected_sms:
    raise SystemExit(f"GoTrue SMS hook URI is not internal-IP HTTP: {auth_env.get('GOTRUE_HOOK_SEND_SMS_URI')!r}")
PY

  rm -f "$rendered"
  return "$rc"
}

# The frontend test now proves the deployed browser artifact is DNS-free. The
# source repository may still contain production docs/tests; only runtime files
# under /var/www/spark are part of this check.
test_frontend_deploy() {
  test_frontend_deploy_dnsless_base || return 1
  local index="/var/www/spark/index.html" base
  base="$(airgap_ip_base_url)"
  [[ -s "$index" ]] || return 1
  grep -Fq "href=\"${base}\"" "$index" || {
    printf 'Frontend preconnect does not point at the internal-IP origin: %s\n' "$base" >>"$CURRENT_LOG"
    return 1
  }
  if airgap_dnsless_tree_has_legacy_domain /var/www/spark; then
    printf 'Deployed frontend still contains a shahrmeeting.ir runtime reference.\n' >>"$CURRENT_LOG"
    grep -RInE --include='*.html' --include='*.js' --include='*.mjs' --include='*.css' --include='*.json' \
      "$(airgap_dnsless_forbidden_runtime_pattern)" /var/www/spark >>"$CURRENT_LOG" 2>&1 || true
    return 1
  fi
}
