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
  # Keep the cookie/map key at 128 bits (32 hex chars). This is cryptographically
  # sufficient for a random session token and fits Nginx's default map hash bucket
  # on Ubuntu 24.04 without changing global map_hash_bucket_size.
  if [[ ! "$token" =~ ^[A-Fa-f0-9]{32}$ ]]; then
    token="$(openssl rand -hex 16)" || return 1
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

# -----------------------------------------------------------------------------
# Node-independent Supabase modern auth keys.
# env-modern.sh originally used Node's crypto binding for validation/generation.
# On the target Ubuntu/Node runtime that path can terminate with SIGSEGV (139).
# Keep the exact .env contract but use Python stdlib + OpenSSL CLI instead.
# -----------------------------------------------------------------------------

modern_auth_keys_valid() {
  local file="${SUPABASE_ROOT}/.env"
  JWT_SECRET_VALUE="$(env_get "$file" JWT_SECRET)" \
  SUPABASE_PUBLISHABLE_KEY_VALUE="$(env_get "$file" SUPABASE_PUBLISHABLE_KEY)" \
  SUPABASE_SECRET_KEY_VALUE="$(env_get "$file" SUPABASE_SECRET_KEY)" \
  ANON_KEY_ASYMMETRIC_VALUE="$(env_get "$file" ANON_KEY_ASYMMETRIC)" \
  SERVICE_ROLE_KEY_ASYMMETRIC_VALUE="$(env_get "$file" SERVICE_ROLE_KEY_ASYMMETRIC)" \
  JWT_KEYS_VALUE="$(env_get "$file" JWT_KEYS)" \
  JWT_JWKS_VALUE="$(env_get "$file" JWT_JWKS)" \
  python3 - <<'PY'
import base64,json,os
secret=os.environ.get('JWT_SECRET_VALUE','')
publishable=os.environ.get('SUPABASE_PUBLISHABLE_KEY_VALUE','')
service=os.environ.get('SUPABASE_SECRET_KEY_VALUE','')
anon_jwt=os.environ.get('ANON_KEY_ASYMMETRIC_VALUE','')
service_jwt=os.environ.get('SERVICE_ROLE_KEY_ASYMMETRIC_VALUE','')
raw_keys=os.environ.get('JWT_KEYS_VALUE','')
raw_jwks=os.environ.get('JWT_JWKS_VALUE','')
if not all((secret,publishable,service,anon_jwt,service_jwt,raw_keys,raw_jwks)):
    raise SystemExit(1)
if not publishable.startswith('sb_publishable_') or not service.startswith('sb_secret_'):
    raise SystemExit(1)
def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()
def decode_part(value):
    value += '=' * (-len(value) % 4)
    return json.loads(base64.urlsafe_b64decode(value).decode())
try:
    keys=json.loads(raw_keys); jwks=json.loads(raw_jwks)
    if not isinstance(keys,list) or not isinstance(jwks,dict) or not isinstance(jwks.get('keys'),list): raise ValueError
    expected_k=b64url(secret.encode())
    oct_private=next((k for k in keys if isinstance(k,dict) and k.get('kty')=='oct' and k.get('alg')=='HS256'),None)
    oct_public=next((k for k in jwks['keys'] if isinstance(k,dict) and k.get('kty')=='oct' and k.get('alg')=='HS256'),None)
    ec_private=next((k for k in keys if isinstance(k,dict) and k.get('kty')=='EC' and k.get('alg')=='ES256' and k.get('d')),None)
    ec_public=next((k for k in jwks['keys'] if isinstance(k,dict) and k.get('kty')=='EC' and k.get('alg')=='ES256' and not k.get('d')),None)
    if not oct_private or not oct_public or oct_private.get('k')!=expected_k or oct_public.get('k')!=expected_k: raise ValueError
    if not ec_private or not ec_public or not ec_private.get('kid') or ec_private.get('kid')!=ec_public.get('kid'): raise ValueError
    if ec_private.get('x')!=ec_public.get('x') or ec_private.get('y')!=ec_public.get('y'): raise ValueError
    for token,role in ((anon_jwt,'anon'),(service_jwt,'service_role')):
        parts=token.split('.')
        if len(parts)!=3: raise ValueError
        header=decode_part(parts[0]); payload=decode_part(parts[1])
        if header.get('alg')!='ES256' or header.get('kid')!=ec_private.get('kid') or payload.get('role')!=role: raise ValueError
except Exception:
    raise SystemExit(1)
PY
}

generate_modern_auth_keys() {
  local file="${SUPABASE_ROOT}/.env" jwt_secret tmp output key value
  jwt_secret="$(env_get "$file" JWT_SECRET)"
  [[ -n "$jwt_secret" ]] || { env_validation_error "JWT_SECRET is required before generating modern auth keys"; return 1; }
  command -v openssl >/dev/null 2>&1 || { env_validation_error "openssl is required for modern auth key generation"; return 1; }

  tmp="$(mktemp -d)" || return 1
  if ! openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "${tmp}/ec.pem" >/dev/null 2>&1; then
    rm -rf "$tmp"
    env_validation_error "OpenSSL failed to generate P-256 key"
    return 1
  fi
  if ! openssl pkey -in "${tmp}/ec.pem" -text -noout >"${tmp}/ec.txt" 2>/dev/null; then
    rm -rf "$tmp"
    env_validation_error "OpenSSL failed to export P-256 key material"
    return 1
  fi

  output="$(JWT_SECRET_VALUE="$jwt_secret" EC_KEY_FILE="${tmp}/ec.pem" EC_TEXT_FILE="${tmp}/ec.txt" python3 - <<'PY'
import base64,hashlib,json,os,secrets,subprocess,tempfile,time,uuid
from pathlib import Path

def b64url(data): return base64.urlsafe_b64encode(data).rstrip(b'=').decode()
def parse_key_text(text):
    priv=[]; pub=[]; section=None
    for raw in text.splitlines():
        line=raw.strip()
        if line=='priv:': section='priv'; continue
        if line=='pub:': section='pub'; continue
        if line.startswith(('ASN1 OID:','NIST CURVE:')): section=None; continue
        if section in ('priv','pub') and line:
            try: chunk=bytes.fromhex(line.replace(':',''))
            except ValueError: continue
            (priv if section=='priv' else pub).extend(chunk)
    priv=bytes(priv); pub=bytes(pub)
    if len(priv)!=32 or len(pub)!=65 or pub[0]!=4: raise RuntimeError('unexpected P-256 key format')
    return priv,pub[1:33],pub[33:65]
def read_len(data,idx):
    first=data[idx]; idx+=1
    if first<128: return first,idx
    n=first & 0x7f
    return int.from_bytes(data[idx:idx+n],'big'),idx+n
def der_to_p1363(sig):
    i=0
    if sig[i]!=0x30: raise RuntimeError('invalid ECDSA DER sequence')
    i+=1; _,i=read_len(sig,i); vals=[]
    for _ in range(2):
        if sig[i]!=0x02: raise RuntimeError('invalid ECDSA DER integer')
        i+=1; ln,i=read_len(sig,i); v=sig[i:i+ln]; i+=ln
        while len(v)>32 and v[0]==0: v=v[1:]
        if len(v)>32: raise RuntimeError('oversized ECDSA integer')
        vals.append(v.rjust(32,b'\0'))
    return vals[0]+vals[1]

secret=os.environ['JWT_SECRET_VALUE']; key_file=os.environ['EC_KEY_FILE']
text=Path(os.environ['EC_TEXT_FILE']).read_text(encoding='utf-8')
d,x,y=parse_key_text(text); kid=str(uuid.uuid4())
oct_key={'kty':'oct','k':b64url(secret.encode()),'alg':'HS256'}
ec_private={'kty':'EC','kid':kid,'use':'sig','key_ops':['sign','verify'],'alg':'ES256','ext':True,'crv':'P-256','x':b64url(x),'y':b64url(y),'d':b64url(d)}
ec_public={'kty':'EC','kid':kid,'use':'sig','key_ops':['verify'],'alg':'ES256','ext':True,'crv':'P-256','x':b64url(x),'y':b64url(y)}
def sign_es256(payload):
    header={'alg':'ES256','typ':'JWT','kid':kid}
    h=b64url(json.dumps(header,separators=(',',':')).encode()); p=b64url(json.dumps(payload,separators=(',',':')).encode())
    data=(h+'.'+p).encode()
    with tempfile.NamedTemporaryFile() as src, tempfile.NamedTemporaryFile() as dst:
        src.write(data); src.flush()
        subprocess.run(['openssl','dgst','-sha256','-sign',key_file,'-out',dst.name,src.name],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        sig=Path(dst.name).read_bytes()
    return h+'.'+p+'.'+b64url(der_to_p1363(sig))
def opaque(prefix):
    random=b64url(secrets.token_bytes(17))[:22]
    intermediate=prefix+random
    checksum=b64url(hashlib.sha256(('supabase-self-hosted|'+intermediate).encode()).digest())[:8]
    return intermediate+'_'+checksum
now=int(time.time()); exp=now+5*365*24*3600
print('SUPABASE_PUBLISHABLE_KEY='+opaque('sb_publishable_'))
print('SUPABASE_SECRET_KEY='+opaque('sb_secret_'))
print('ANON_KEY_ASYMMETRIC='+sign_es256({'role':'anon','iss':'supabase','iat':now,'exp':exp}))
print('SERVICE_ROLE_KEY_ASYMMETRIC='+sign_es256({'role':'service_role','iss':'supabase','iat':now,'exp':exp}))
print('JWT_KEYS='+json.dumps([ec_private,oct_key],separators=(',',':')))
print('JWT_JWKS='+json.dumps({'keys':[ec_public,oct_key]},separators=(',',':')))
PY
)" || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"

  while IFS='=' read -r key value; do
    case "$key" in
      SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY|ANON_KEY_ASYMMETRIC|SERVICE_ROLE_KEY_ASYMMETRIC|JWT_KEYS|JWT_JWKS)
        env_set "$file" "$key" "$value" ;;
    esac
  done <<<"$output"
  chmod 600 "$file"
}
