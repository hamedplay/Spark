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

[[ -s "$payload/requested-packages.txt" ]] || {
  echo 'requested-packages.txt is missing or empty.' >&2
  exit 1
}

mapfile -t archives < <(find "$payload" -maxdepth 1 -type f -name '*.deb' -print | sort)
((${#archives[@]})) || { echo 'Local APT payload is empty.' >&2; exit 1; }

# Build a transient local APT repository from every shipped .deb. The complete
# payload is dependency inventory only; it must NOT be passed to apt-get as a
# list of packages to force-install. Only requested-packages.txt is requested.
repo="$(mktemp -d /var/tmp/spark-airgap-aptrepo.XXXXXX)"
guard="$(mktemp -d /var/tmp/spark-airgap-aptcfg.XXXXXX)"
trap 'rm -rf -- "$repo" "$guard"' EXIT

: >"$repo/Packages"
for archive in "${archives[@]}"; do
  package="$(dpkg-deb -f "$archive" Package)"
  arch="$(dpkg-deb -f "$archive" Architecture)"
  [[ "$arch" == all || "$arch" == "$(dpkg --print-architecture)" ]] || {
    printf 'Wrong architecture: %s (%s).\n' "$package" "$arch" >&2
    exit 1
  }
  name="$(basename "$archive")"
  ln "$archive" "$repo/$name" 2>/dev/null || cp -a "$archive" "$repo/$name"
  dpkg-deb -f "$archive" >>"$repo/Packages"
  printf 'Filename: ./%s\n' "$name" >>"$repo/Packages"
  printf 'Size: %s\n' "$(stat -c '%s' "$archive")" >>"$repo/Packages"
  printf 'SHA256: %s\n\n' "$(sha256sum "$archive" | awk '{print $1}')" >>"$repo/Packages"
done

gzip -c "$repo/Packages" >"$repo/Packages.gz"
mkdir -p "$guard/sources.list.d" "$guard/lists/partial" "$guard/archives/partial"
printf 'deb [trusted=yes] file:%s ./\n' "$repo" >"$guard/sources.list"

mapfile -t requested < <(sed -e 's/#.*$//' -e '/^[[:space:]]*$/d' "$payload/requested-packages.txt")
((${#requested[@]})) || { echo 'No requested packages were found.' >&2; exit 1; }

options=(
  -o "Dir::Etc::sourcelist=$guard/sources.list"
  -o "Dir::Etc::sourceparts=$guard/sources.list.d"
  -o "Dir::State::lists=$guard/lists"
  -o "Dir::Cache::archives=$guard/archives"
  -o APT::Get::List-Cleanup=0
  -o Acquire::Languages=none
)

export DEBIAN_FRONTEND=noninteractive
apt-get "${options[@]}" update >/dev/null

# Simulate the transaction first. Refuse removals, but do not force every .deb
# version in the bundle onto the host. Installed compatible/newer packages are
# preserved naturally by APT.
apt-get "${options[@]}" --simulate install -y --no-remove "${requested[@]}"
apt-get "${options[@]}" install -y --no-remove "${requested[@]}"
