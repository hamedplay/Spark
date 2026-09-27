from __future__ import annotations

import subprocess
from pathlib import Path

from .models import RemoteNode
from .ssh import SSHConfig, redact


class ProfileTransfer:
    def __init__(self, config: SSHConfig):
        config.validate()
        self.config = config

    def copy(self, node: RemoteNode, local_profile: str | Path) -> tuple[bool, str]:
        source = Path(local_profile)
        if not source.is_file():
            return False, f"profile not found: {source}"
        command = [
            "scp", "-q", "-B", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
            "-o", f"UserKnownHostsFile={self.config.known_hosts_file}",
            "-o", f"ConnectTimeout={self.config.connect_timeout_seconds}",
            str(source), f"{node.ssh_user}@{node.host}:{self.config.remote_profile_path}",
        ]
        try:
            completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return False, redact(str(exc))
        if completed.returncode != 0:
            return False, redact(completed.stderr or completed.stdout)
        return True, "profile transferred"
