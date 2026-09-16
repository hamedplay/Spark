#!/usr/bin/env bash
# Standalone local APT installer, also shipped under bundle/apt/install-local.sh.
# Requires only Bash, dpkg tools and APT from the target Ubuntu base system.
set -Eeuo pipefail
payload="$(readlink -f "${1:?APT payload directory is required}")"
[[ -d "$payload" ]] || exit 2
if [[ -f "$payload/platform.env" ]]; then
  . /etc/os-release
  expected="$(sed -n 's/^UBUNTU_VERSION=//p' "$payload/platform.env")"
  [[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == "$expected" ]] || {
    printf 'APT payload targets Ubuntu %s; host is %s %s. Rebuild for the target release.\n' "$expected" "${ID:-unknown}" "${VERSION_ID:-unknown}" >&2
    exit 1
  }
fi
mapfile -t archives < <(find "$payload" -maxdepth 1 -type f -name '*.deb' -print | sort)
((${#archives[@]})) || { echo 'Local APT payload is empty.' >&2; exit 1; }
selected=()
for archive in "${archives[@]}"; do
  package="$(dpkg-deb -f "$archive" Package)"
  version="$(dpkg-deb -f "$archive" Version)"
  arch="$(dpkg-deb -f "$archive" Architecture)"
  [[ "$arch" == all || "$arch" == "$(dpkg --print-architecture)" ]] || {
    printf 'Wrong architecture: %s (%s).\n' "$package" "$arch" >&2; exit 1;
  }
  query="$package"
  [[ "$arch" == all ]] || query="${package}:${arch}"
  installed="$(dpkg-query -W -f='${Status}\t${Version}' "$query" 2>/dev/null || true)"
  if [[ "$installed" == $'install ok installed\t'* ]]; then
    installed="${installed#*$'\t'}"
    if dpkg --compare-versions "$installed" gt "$version"; then
      printf 'Preserving newer installed %s: %s (bundle: %s).\n' "$package" "$installed" "$version"
      continue
    fi
  fi
  selected+=("$archive")
done
((${#selected[@]})) || { echo 'All bundled packages are older than installed packages; nothing to install.'; exit 0; }
guard="$(mktemp -d)"
trap 'rm -rf -- "$guard"' EXIT
mkdir "$guard/sources.list.d"
: >"$guard/sources.list"
options=(-o "Dir::Etc::sourcelist=$guard/sources.list" -o "Dir::Etc::sourceparts=$guard/sources.list.d" -o APT::Get::List-Cleanup=0)
export DEBIAN_FRONTEND=noninteractive
# Resolve the complete transaction before any package is changed. Never remove
# host packages or force older versions to satisfy the transferred snapshot.
if ! apt-get "${options[@]}" --simulate install -y --no-remove "${selected[@]}"; then
  echo 'Local dependency resolution failed. Rebuild/refresh the bundle for this Ubuntu release; no packages were changed.' >&2
  exit 1
fi
apt-get "${options[@]}" install -y --no-remove "${selected[@]}"
