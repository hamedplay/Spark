#!/usr/bin/env bash
# Linux host maintenance and read-only inspection actions for Spark Manager.

linux_system_network() {
  title
  new_log "linux-network"
  {
    echo "== Hostname =="; hostnamectl 2>/dev/null || hostname
    echo; echo "== Addresses =="; ip -br address
    echo; echo "== Routes =="; ip route
    echo; echo "== Rules =="; ip rule
    echo; echo "== DNS =="; resolvectl status 2>/dev/null || cat /etc/resolv.conf
    echo; echo "== Listening sockets =="; ss -lntup
  } 2>&1 | tee -a "$CURRENT_LOG"
}

linux_system_firewall() {
  title
  new_log "linux-firewall"
  {
    echo "== UFW =="; ufw status verbose 2>/dev/null || echo "UFW unavailable"
    echo; echo "== nftables =="; nft list ruleset 2>/dev/null || echo "nftables unavailable or not configured"
  } 2>&1 | tee -a "$CURRENT_LOG"
}

linux_system_version() {
  title
  new_log "linux-version"
  {
    echo "== OS =="; cat /etc/os-release
    echo; echo "== Kernel =="; uname -a
    echo; echo "== Architecture =="; dpkg --print-architecture 2>/dev/null || uname -m
    echo; echo "== Uptime =="; uptime
  } 2>&1 | tee -a "$CURRENT_LOG"
}

linux_system_package_versions() {
  title
  new_log "linux-package-versions"
  {
    echo "== Key package versions =="
    for package in nginx docker-ce docker-ce-cli containerd.io docker-compose-plugin nodejs git curl openssl ca-certificates; do
      dpkg-query -W -f='${binary:Package}\t${Version}\n' "$package" 2>/dev/null || true
    done
    echo
    command -v docker >/dev/null && docker --version || true
    command -v docker >/dev/null && docker compose version || true
    command -v node >/dev/null && node --version || true
    command -v npm >/dev/null && npm --version || true
    command -v nginx >/dev/null && nginx -v 2>&1 || true
  } 2>&1 | tee -a "$CURRENT_LOG"
}

linux_system_reboot() {
  title
  new_log "linux-reboot"
  if ! confirm_word "The server will reboot immediately and the Spark Manager session will disconnect." "REBOOT"; then
    warn "Reboot cancelled."
    return 1
  fi
  sync
  ok "Reboot requested."
  systemctl reboot
}

linux_system_history_delete() {
  title
  new_log "linux-history-delete"
  if ! confirm_word "Shell history for root and the invoking sudo user will be deleted. Application/database data is not affected." "DELETE-HISTORY"; then
    warn "History deletion cancelled."
    return 1
  fi

  local user home
  for user in root "${SUDO_USER:-}"; do
    [[ -n "$user" ]] || continue
    home="$(getent passwd "$user" 2>/dev/null | cut -d: -f6)"
    [[ -n "$home" && -d "$home" ]] || continue
    : >"${home}/.bash_history" 2>/dev/null || true
    : >"${home}/.zsh_history" 2>/dev/null || true
    rm -f "${home}/.lesshst" 2>/dev/null || true
  done
  ok "Shell history files were cleared."
}

linux_system_log_delete() {
  title
  new_log "linux-log-delete"
  if ! confirm_word "Archived systemd journal and rotated Linux logs will be deleted. Active application/database data and Docker volumes are not affected." "DELETE-LOGS"; then
    warn "Log deletion cancelled."
    return 1
  fi

  run_logged "Rotate systemd journal" journalctl --rotate || return 1
  run_logged "Vacuum archived systemd journal" journalctl --vacuum-time=1s || return 1
  find /var/log -xdev -type f \( -name '*.gz' -o -name '*.old' -o -name '*.1' \) -delete 2>>"$CURRENT_LOG" || true
  ok "Archived Linux logs were deleted. Active log files were preserved."
}

linux_system_cache_delete() {
  title
  new_log "linux-cache-delete"
  if ! confirm_word "APT package cache and npm cache will be cleared. Installed packages and application node_modules are preserved." "DELETE-CACHE"; then
    warn "Cache deletion cancelled."
    return 1
  fi
  run_logged "Clean APT package cache" apt-get clean || return 1
  if command -v npm >/dev/null 2>&1; then
    run_logged "Clean npm cache" npm cache clean --force || return 1
  fi
  ok "Linux package/npm caches were cleared."
}

linux_system_active_users() {
  title
  new_log "linux-active-users"
  {
    echo "== who =="; who || true
    echo; echo "== w =="; w || true
    echo; echo "== systemd logged-in users =="; loginctl list-users --no-pager 2>/dev/null || true
    echo; echo "== recent logins =="; last -n 20 -w 2>/dev/null || true
  } 2>&1 | tee -a "$CURRENT_LOG"
}
