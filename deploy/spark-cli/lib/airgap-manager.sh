# Spark Manager-only Air-Gap bundle build/distribution helpers.

spark_manager_airgap_profile_path() {
  local explicit="${SPARK_ENV_PROFILE:-}"
  local production="/etc/spark-manager/environments/production.yaml"
  local bundled="${SCRIPT_DIR}/config/environments/example.production.yaml"
  if [[ -n "$explicit" ]]; then
    printf '%s\n' "$explicit"
  elif [[ -f "$production" ]]; then
    printf '%s\n' "$production"
  elif [[ -f "$bundled" ]]; then
    printf '%s\n' "$bundled"
  else
    printf '%s\n' "$production"
  fi
}

spark_manager_airgap_revision() {
  if [[ -f "${SCRIPT_DIR}/.revision" ]]; then
    tr -d '[:space:]' <"${SCRIPT_DIR}/.revision"
  elif [[ -d "${SPARK_ROOT}/.git" ]]; then
    command git -C "$SPARK_ROOT" rev-parse HEAD
  else
    return 1
  fi
}

spark_manager_airgap_build() (
  set -Eeuo pipefail
  local output_root="${1:-${PWD}}" target_release="${2:-}" loaded_revision revision root bundle_id archive partial source source_manager
  local snapshot_root="${SPARK_MANAGER_BUILD_SNAPSHOT_ROOT:-}" snapshot_owned=0
  loaded_revision="$(spark_manager_airgap_revision 2>/dev/null || true)"

  if [[ -n "$snapshot_root" ]]; then
    [[ -d "$snapshot_root/deploy/spark-cli" ]] || { fail "Manager build snapshot is invalid: $snapshot_root"; return 1; }
    revision="${SPARK_MANAGER_BUILD_REVISION:-}"
    [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { fail "Manager build snapshot revision is invalid."; return 1; }
    source="$snapshot_root/deploy/spark-cli"
  else
    [[ -d "${SPARK_ROOT}/.git" ]] || { fail "Spark source repository is required at ${SPARK_ROOT}."; return 1; }
    spark_airgap_sync_source_main || return 1
    revision="$(command git -C "$SPARK_ROOT" rev-parse FETCH_HEAD)"
    [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { fail "Unable to resolve fetched Spark revision."; return 1; }

    snapshot_root="$(mktemp -d /tmp/spark-manager-build.XXXXXX)"
    snapshot_owned=1
    if ! command git -C "$SPARK_ROOT" archive --format=tar "$revision" | tar -xf - -C "$snapshot_root"; then
      rm -rf "$snapshot_root"
      fail "Unable to materialize clean Spark build snapshot."
      return 1
    fi
    source="$snapshot_root/deploy/spark-cli"
    source_manager="$source/lib/spark-manager-airgap"
    [[ -f "$source_manager" ]] || { rm -rf "$snapshot_root"; fail "Manager Air-Gap entrypoint is missing from fetched revision."; return 1; }

    if [[ "$loaded_revision" != "$revision" || "$(readlink -f "$SCRIPT_DIR")" != "$(readlink -f "$source")" ]]; then
      exec env \
        SPARK_MANAGER_BUILD_SNAPSHOT_ROOT="$snapshot_root" \
        SPARK_MANAGER_BUILD_REVISION="$revision" \
        bash "$source_manager" --build "$output_root" "$target_release"
    fi
  fi

  if (( snapshot_owned )); then
    trap 'rm -rf "$snapshot_root"' EXIT
  elif [[ -n "${SPARK_MANAGER_BUILD_SNAPSHOT_ROOT:-}" ]]; then
    trap 'rm -rf "$snapshot_root"' EXIT
  fi

  if [[ -z "$target_release" ]]; then
    . /etc/os-release
    target_release="$(airgap_normalize_ubuntu_release "${VERSION_ID:-}")" || return 1
  else
    target_release="$(airgap_normalize_ubuntu_release "$target_release")" || return 1
  fi
  mkdir -p "$output_root"
  output_root="$(readlink -f "$output_root")"
  bundle_id="spark-manager-airgap-${revision:0:12}-ubuntu${target_release}-amd64"
  root="${output_root}/${bundle_id}"
  archive="${output_root}/${bundle_id}.tar.gz"
  [[ ! -e "$root" && ! -e "$archive" ]] || { fail "Manager bundle output already exists: ${bundle_id}"; return 1; }
  mkdir -p "$root/metadata" "$root/manager"

  for file in spark spark-airgap spark-architecture spark-database spark-ui.py spark-ui-base.py spark-ui-core.py spark-migrate database_cli.py spark-manager-airgap-bootstrap; do
    [[ -f "$source/$file" ]] || { fail "Manager source missing: $file"; return 1; }
    cp -a "$source/$file" "$root/manager/$file"
  done
  for dir in core architecture config adapters secrets roles lib; do
    [[ -d "$source/$dir" ]] || { fail "Manager source directory missing: $dir"; return 1; }
    cp -a "$source/$dir" "$root/manager/$dir"
  done
  if [[ -d "$snapshot_root/deploy/livekit" ]]; then
    cp -a "$snapshot_root/deploy/livekit" "$root/manager/livekit"
  fi
  cp -a "$source/bootstrap-manager-airgap.sh" "$root/install.sh"
  chmod 0755 "$root/install.sh" "$root/manager/spark" "$root/manager/spark-airgap" "$root/manager/spark-architecture" "$root/manager/spark-database" "$root/manager/spark-migrate" "$root/manager/spark-manager-airgap-bootstrap" "$root/manager/lib/spark-manager-airgap" "$root/manager/lib/build-manager-airgap"

  python3 - "$root/metadata/manifest.json" "$revision" "$target_release" <<'PY'
import json, sys
path, revision, ubuntu = sys.argv[1:]
with open(path, 'w', encoding='utf-8') as f:
    json.dump({
        'format_version': 1,
        'spark_revision': revision,
        'ubuntu': ubuntu,
        'architecture': 'amd64',
        'payload': 'spark-manager',
    }, f, indent=2, sort_keys=True)
    f.write('\n')
PY
  (cd "$root" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS)
  (cd "$root" && sha256sum -c SHA256SUMS >/dev/null)
  python3 -m compileall -q "$root/manager/core" "$root/manager/config" "$root/manager/architecture" "$root/manager/adapters" "$root/manager/secrets" "$root/manager/roles"
  bash -n "$root/install.sh" "$root/manager/spark" "$root/manager/spark-airgap" "$root/manager/spark-architecture" "$root/manager/spark-database" "$root/manager/spark-manager-airgap-bootstrap" "$root/manager/lib/spark-manager-airgap" "$root/manager/lib/build-manager-airgap"
  SPARK_MANAGER_REVISION="$revision" SPARK_ENV_PROFILE="$root/manager/config/environments/example.production.yaml" \
    PYTHONPATH="$root/manager" python3 "$root/manager/spark-architecture" revision | grep -Fq "Revision: $revision"
  SPARK_MANAGER_REVISION="$revision" "$root/manager/lib/spark-manager-airgap" --help >/dev/null

  partial="$(mktemp "${output_root}/.${bundle_id}.XXXXXX")"
  trap 'rm -rf "$root"; rm -f "$partial"; rm -rf "$snapshot_root"' EXIT
  tar -C "$output_root" -czf "$partial" "$bundle_id"
  gzip -t "$partial"
  mv "$partial" "$archive"
  sha256sum "$archive" >"${archive}.sha256"
  rm -rf "$root" "$snapshot_root"
  trap - EXIT
  ok "Spark Manager Air-Gap bundle created: $archive"
  printf 'Revision: %s\nTarget: Ubuntu %s / amd64\n' "$revision" "$target_release"
)

spark_manager_airgap_inventory() {
  local profile="$1"
  PYTHONPATH="$SCRIPT_DIR" python3 - "$profile" <<'PY'
import sys
from config.loader import load_environment
from roles.environment.remote.inventory import build_inventory
from roles.environment.remote.settings import load_remote_settings
p=sys.argv[1]
e=load_environment(p)
s=load_remote_settings(p)
for n in build_inventory(e):
    print(f"{n.id}\t{n.role}\t{n.host}\t{n.ssh_user}\t{s.known_hosts_file}\t{s.connect_timeout_seconds}\t{s.command_timeout_seconds}")
PY
}

spark_manager_airgap_verify_revisions() {
  local profile="${1:-$(spark_manager_airgap_profile_path)}" desired="${2:-$(spark_manager_airgap_revision)}"
  [[ -f "$profile" ]] || { fail "Production profile not found: $profile"; return 1; }
  [[ "$desired" =~ ^[0-9a-f]{40}$ ]] || { fail "Desired Manager revision is unavailable."; return 1; }
  printf 'SPARK MANAGER DISTRIBUTION\n\n'
  printf '%-18s %-15s %s\n' 'Node' 'Revision' 'Status'
  local id role host user known connect command output actual status overall=0
  while IFS=$'\t' read -r id role host user known connect command; do
    [[ -n "$user" ]] || { printf '%-18s %-15s %s\n' "$id" '-' 'SSH_USER_MISSING'; overall=1; continue; }
    output="$(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known" -o "ConnectTimeout=$connect" \
      "$user@$host" sudo -n /usr/local/bin/spark-architecture revision 2>/dev/null || true)"
    actual="$(sed -n 's/^Revision: //p' <<<"$output" | tail -n1)"
    if [[ "$actual" == "$desired" ]]; then status=PASS; else status=VERSION_MISMATCH; overall=1; fi
    printf '%-18s %-15s %s\n' "$id" "${actual:0:12}" "$status"
  done < <(spark_manager_airgap_inventory "$profile")
  printf '\nRESULT            %s\n' "$([[ $overall -eq 0 ]] && echo READY || echo NOT_READY)"
  return "$overall"
}

spark_manager_airgap_install_environment() {
  local bundle="${1:-}" profile="${2:-$(spark_manager_airgap_profile_path)}" work root manifest revision
  [[ -n "$bundle" ]] || read -r -p 'Path to spark-manager-airgap-*.tar.gz: ' bundle
  [[ -f "$bundle" ]] || { fail "Manager bundle not found: $bundle"; return 1; }
  [[ -f "$profile" ]] || { fail "Production profile not found: $profile"; return 1; }
  work="$(mktemp -d)"; trap 'rm -rf "$work"' RETURN
  tar -tzf "$bundle" | grep -Eq '^spark-manager-airgap-[^/]+/metadata/manifest.json$' || { fail 'Invalid Manager bundle archive.'; return 1; }
  tar -xzf "$bundle" -C "$work"
  root="$(find "$work" -mindepth 1 -maxdepth 1 -type d -name 'spark-manager-airgap-*' | head -n1)"
  [[ -n "$root" ]] || { fail 'Manager bundle root missing.'; return 1; }
  (cd "$root" && sha256sum -c SHA256SUMS >/dev/null) || { fail 'Manager bundle checksum verification failed.'; return 1; }
  manifest="$root/metadata/manifest.json"
  revision="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["spark_revision"])' "$manifest")"
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { fail 'Invalid Manager bundle revision.'; return 1; }

  local id role host user known connect command remote_archive launcher_status
  while IFS=$'\t' read -r id role host user known connect command; do
    [[ -n "$user" ]] || { fail "SSH user missing for $id"; return 1; }
    remote_archive="/var/tmp/spark-manager-inbox/spark-manager-airgap-${revision:0:12}.tar.gz"
    launcher_status="$(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known" -o "ConnectTimeout=$connect" \
      "$user@$host" 'test -x /usr/local/sbin/spark-manager-airgap-bootstrap && test -d /var/tmp/spark-manager-inbox && echo READY' 2>/dev/null || true)"
    [[ "$launcher_status" == READY ]] || {
      fail "Restricted Manager bootstrap launcher is missing on $id. Perform the first local Manager bootstrap on that node or have the OS/security baseline provision /usr/local/sbin/spark-manager-airgap-bootstrap."
      return 1
    }
    info "Distributing Manager ${revision:0:12} to ${id} (${host})."
    scp -q -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known" -o "ConnectTimeout=$connect" \
      "$bundle" "$user@$host:$remote_archive" || { fail "Manager transfer failed: $id"; return 1; }
    ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known" -o "ConnectTimeout=$connect" \
      "$user@$host" sudo -n /usr/local/sbin/spark-manager-airgap-bootstrap "$remote_archive" \
      || { fail "Manager install failed: $id"; return 1; }
  done < <(spark_manager_airgap_inventory "$profile")
  spark_manager_airgap_verify_revisions "$profile" "$revision"
}
