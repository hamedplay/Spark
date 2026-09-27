from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from config.yaml_loader import safe_load_profile


@dataclass(frozen=True)
class RemoteSettings:
    known_hosts_file: str = "/etc/ssh/ssh_known_hosts"
    connect_timeout_seconds: int = 5
    command_timeout_seconds: int = 1800
    remote_profile_path: str = "/tmp/spark-production.yaml"
    state_file: str = "/var/lib/spark-manager/environment/production.json"


def load_remote_settings(profile_path: str | Path) -> RemoteSettings:
    path = Path(profile_path)
    data = safe_load_profile(path.read_text())
    jump = (data.get("jump_server", {}) if isinstance(data, dict) else {}) or {}
    remote = jump.get("remote", {}) or {}
    return RemoteSettings(
        known_hosts_file=str(remote.get("known_hosts_file", "/etc/ssh/ssh_known_hosts")),
        connect_timeout_seconds=int(remote.get("connect_timeout_seconds", 5)),
        command_timeout_seconds=int(remote.get("command_timeout_seconds", 1800)),
        remote_profile_path=str(remote.get("remote_profile_path", "/tmp/spark-production.yaml")),
        state_file=str(remote.get("state_file", "/var/lib/spark-manager/environment/production.json")),
    )
