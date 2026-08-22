# Node-independent Supabase modern auth key compatibility layer.
# Loaded after env-modern.sh. It preserves the same .env contract while avoiding
# Node/OpenSSL binding crashes during install-06 on the host.

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
import base64,json,os,sys
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
def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()
def decode_part(value):
    value += '=' * (-len(value) % 4)
    return json.loads(base64.urlsafe_b64decode(value).decode())
try:
    keys=json.loads(raw_keys)
    jwks=json.loads(raw_jwks)
    if not isinstance(keys,list) or not isinstance(jwks,dict) or not isinstance(jwks.get('keys'),list):
        raise ValueError
    expected_k=b64url(secret.encode())
    oct_private=next((k for k in keys if isinstance(k,dict) and k.get('kty')=='oct' and k.get('alg')=='HS256'),None)
    oct_public=next((k for k in jwks['keys'] if isinstance(k,dict) and k.get('kty')=='oct' and k.get('alg')=='HS256'),None)
    ec_private=next((k for k in keys if isinstance(k,dict) and k.get('kty')=='EC' and k.get('alg')=='ES256' and k.get('d')),None)
    ec_public=next((k for k in jwks['keys'] if isinstance(k,dict) and k.get('kty')=='EC' and k.get('alg')=='ES256' and not k.get('d')),None)
    if not oct_private or not oct_public or oct_private.get('k')!=expected_k or oct_public.get('k')!=expected_k:
        raise ValueError
    if not ec_private or not ec_public:
        raise ValueError
    if not ec_private.get('kid') or ec_private.get('kid')!=ec_public.get('kid'):
        raise ValueError
    if ec_private.get('x')!=ec_public.get('x') or ec_private.get('y')!=ec_public.get('y'):
        raise ValueError
    for token,role in ((anon_jwt,'anon'),(service_jwt,'service_role')):
        parts=token.split('.')
        if len(parts)!=3:
            raise ValueError
        header=decode_part(parts[0]); payload=decode_part(parts[1])
        if header.get('alg')!='ES256' or header.get('kid')!=ec_private.get('kid') or payload.get('role')!=role:
            raise ValueError
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

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

def parse_key_text(text):
    priv=[]; pub=[]; section=None
    for raw in text.splitlines():
        line=raw.strip()
        if line=='priv:': section='priv'; continue
        if line=='pub:': section='pub'; continue
        if line.startswith(('ASN1 OID:','NIST CURVE:')): section=None; continue
        if section in ('priv','pub') and line:
            try:
                chunk=bytes.fromhex(line.replace(':',''))
            except ValueError:
                continue
            (priv if section=='priv' else pub).extend(chunk)
    priv=bytes(priv); pub=bytes(pub)
    if len(priv)!=32 or len(pub)!=65 or pub[0]!=4:
        raise RuntimeError(f'unexpected EC key sizes priv={len(priv)} pub={len(pub)}')
    return priv,pub[1:33],pub[33:65]

def read_len(data,idx):
    first=data[idx]; idx+=1
    if first<128: return first,idx
    n=first & 0x7f
    return int.from_bytes(data[idx:idx+n],'big'),idx+n

def der_to_p1363(sig):
    i=0
    if sig[i]!=0x30: raise RuntimeError('invalid ECDSA DER sequence')
    i+=1; _,i=read_len(sig,i)
    vals=[]
    for _ in range(2):
        if sig[i]!=0x02: raise RuntimeError('invalid ECDSA DER integer')
        i+=1; ln,i=read_len(sig,i)
        v=sig[i:i+ln]; i+=ln
        while len(v)>32 and v[0]==0: v=v[1:]
        if len(v)>32: raise RuntimeError('oversized ECDSA integer')
        vals.append(v.rjust(32,b'\0'))
    return vals[0]+vals[1]

secret=os.environ['JWT_SECRET_VALUE']
key_file=os.environ['EC_KEY_FILE']
text=Path(os.environ['EC_TEXT_FILE']).read_text(encoding='utf-8')
d,x,y=parse_key_text(text)
kid=str(uuid.uuid4())
oct_key={'kty':'oct','k':b64url(secret.encode()),'alg':'HS256'}
ec_private={'kty':'EC','kid':kid,'use':'sig','key_ops':['sign','verify'],'alg':'ES256','ext':True,'crv':'P-256','x':b64url(x),'y':b64url(y),'d':b64url(d)}
ec_public={'kty':'EC','kid':kid,'use':'sig','key_ops':['verify'],'alg':'ES256','ext':True,'crv':'P-256','x':b64url(x),'y':b64url(y)}

def sign_es256(payload):
    header={'alg':'ES256','typ':'JWT','kid':kid}
    h=b64url(json.dumps(header,separators=(',',':')).encode())
    p=b64url(json.dumps(payload,separators=(',',':')).encode())
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
