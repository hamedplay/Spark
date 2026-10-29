#!/usr/bin/env bash
# Run on the Application server that currently serves ordinary send-sms calls.
# Updates the existing router and send-sms dependency tree. Does not send messages,
# apply database SQL, edit credentials or install a separate worker/timer.
set -euo pipefail
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then exec sudo -- bash "$0" "$@"; fi
source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_container="${1:-}"
if [[ -z "$runtime_container" ]]; then
  mapfile -t candidates < <(docker ps --format '{{.ID}} {{.Image}} {{.Names}}' |
    awk '$2 ~ /supabase\/edge-runtime/ || $3 == "spark-edge-runtime" || $3 == "supabase-edge-functions" {print $1}')
  if [[ ${#candidates[@]} -ne 1 ]]; then
    echo 'Specify the existing Functions container: bash apply-recurring-sms-runtime.sh CONTAINER' >&2
    exit 1
  fi
  runtime_container="${candidates[0]}"
fi
mount_root="$(docker inspect "$runtime_container" | python3 -c '
import json,sys
row=json.load(sys.stdin)[0]
if "VERIFY_JWT=true" in row.get("Config",{}).get("Env",[]):
    raise SystemExit("This router requires in-function authentication (VERIFY_JWT=false); nothing changed")
matches=[m for m in row["Mounts"] if m["Destination"]=="/home/deno/functions" and m["Type"]=="bind"]
if len(matches)!=1: raise SystemExit("Expected one bind mount at /home/deno/functions; nothing changed")
print(matches[0]["Source"])
')"
[[ -f "$mount_root/send-sms/index.ts" ]] || { echo 'Existing send-sms entrypoint is missing; nothing changed' >&2; exit 1; }
[[ -f "$mount_root/main/index.ts" ]] || { echo 'Existing main router is missing; nothing changed' >&2; exit 1; }
backup_root="$(mktemp -d /var/tmp/spark-recurring-sms-backup.XXXXXXXX)"
python3 - "$source_root/supabase/functions" "$mount_root" "$backup_root" <<'PY'
import json,re,shutil,sys
from pathlib import Path
source,target,backup=map(lambda p:Path(p).resolve(),sys.argv[1:])
stack=[source/'send-sms/index.ts'];files={}
while stack:
    path=stack.pop().resolve();relative=path.relative_to(source)
    if str(relative) in files: continue
    text=path.read_text();files[str(relative)]=path
    for dependency in re.findall(r'''['"]([.][.]?/[^'"]+)['"]''',text):
        stack.append(path.parent/dependency)
files['main/index.ts']=source.parent.parent/'deploy/spark-cli/edge-main/index.ts'
files['main/index.ts'].read_text()
# Resolve every dependency before touching the live mount.
manifest=[]
for relative in sorted(files):
    live=(target/relative).resolve()
    live.relative_to(target)
    if live.exists() and not live.is_file(): raise RuntimeError(f'Unexpected runtime path: {relative}')
    existed=live.is_file();manifest.append({'path':relative,'existed':existed})
    if existed:
        saved=backup/relative;saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(live,saved)
(backup/'manifest.json').write_text(json.dumps(manifest))
try:
    for relative,path in files.items():
        live=target/relative;live.parent.mkdir(parents=True,exist_ok=True)
        staged=live.with_name(live.name+'.spark-next')
        shutil.copyfile(path,staged);staged.chmod(0o644);staged.replace(live)
except Exception:
    for item in manifest:
        live=target/item['path']
        if item['existed']: shutil.copy2(backup/item['path'],live)
        else: live.unlink(missing_ok=True)
    raise
print(f'Updated {len(files)} files for the existing send-sms entrypoint')
PY
if ! docker restart "$runtime_container"; then
  python3 - "$mount_root" "$backup_root" <<'PY'
import json,shutil,sys
from pathlib import Path
target,backup=map(Path,sys.argv[1:])
for item in json.loads((backup/'manifest.json').read_text()):
    live=target/item['path']
    if item['existed']: shutil.copy2(backup/item['path'],live)
    else: live.unlink(missing_ok=True)
PY
  docker start "$runtime_container" || true
  echo "Restart failed; previous files restored. Backup: $backup_root" >&2
  exit 1
fi
echo "Existing Functions runtime restarted. Source backup: $backup_root"
echo 'Apply the accompanying route_recurring_cron_through_shared_sms migration on the Database server.'
echo 'The next normal scheduler tick can process existing pending messages; no send probe was run.'
