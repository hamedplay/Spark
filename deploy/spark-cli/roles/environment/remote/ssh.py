from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .models import RemoteNode, RemoteOperation, RemoteResult, RemoteStatus

SECRET_RE = re.compile(r"(?i)(password|secret|token|api[_-]?key|service[_-]?role[_-]?key|jwt[_-]?secret)\s*[=:]\s*([^\s]+)")


def redact(text: str) -> str:
    return SECRET_RE.sub(lambda match: f"{match.group(1)}=[REDACTED]", text or "")


@dataclass(frozen=True)
class SSHConfig:
    known_hosts_file: str
    connect_timeout_seconds: int = 5
    command_timeout_seconds: int = 1800
    remote_profile_path: str = "/tmp/spark-production.yaml"

    def validate(self) -> None:
        path = Path(self.known_hosts_file)
        if not path.is_file():
            raise FileNotFoundError(f"known_hosts file is required: {path}")
        if self.connect_timeout_seconds < 1 or self.command_timeout_seconds < 1:
            raise ValueError("SSH timeouts must be positive")


_OPERATION_ARGS = {
    RemoteOperation.REVISION: ("revision",),
    RemoteOperation.PROFILE: ("profile",),
    RemoteOperation.INSTALL: ("install-full", "--resume"),
    RemoteOperation.STATUS: ("status",),
    RemoteOperation.VALIDATE: ("validate-environment",),
    RemoteOperation.ROLE_HEALTH: ("role-health",),
    RemoteOperation.NETWORK: ("network-check",),
    RemoteOperation.REPAIR: ("repair", "--resume"),
}


class OpenSSHClient:
    def __init__(self, config: SSHConfig):
        config.validate()
        self.config = config

    def _base(self, node: RemoteNode) -> list[str]:
        return [
            "ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
            "-o", f"UserKnownHostsFile={self.config.known_hosts_file}",
            "-o", f"ConnectTimeout={self.config.connect_timeout_seconds}",
            f"{node.ssh_user}@{node.host}",
        ]

    def run(self, node: RemoteNode, operation: RemoteOperation, *, dry_run: bool = False) -> RemoteResult:
        args = list(_OPERATION_ARGS[operation])
        if operation != RemoteOperation.REVISION:
            args.extend(("--profile", self.config.remote_profile_path))
        if dry_run and operation in {RemoteOperation.INSTALL, RemoteOperation.REPAIR}:
            args.append("--dry-run")
        remote = ["sudo", "-n", "/usr/local/bin/spark-architecture", *args]
        command = [*self._base(node), *remote]
        try:
            completed = subprocess.run(
                command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                timeout=self.config.command_timeout_seconds, check=False,
            )
            stdout, stderr = redact(completed.stdout), redact(completed.stderr)
            status = RemoteStatus.COMPLETED if completed.returncode == 0 else RemoteStatus.FAILED
            if operation in {RemoteOperation.REVISION, RemoteOperation.PROFILE, RemoteOperation.STATUS, RemoteOperation.VALIDATE, RemoteOperation.ROLE_HEALTH, RemoteOperation.NETWORK}:
                status = RemoteStatus.PASS if completed.returncode == 0 else RemoteStatus.FAILED
            revision = None
            if operation == RemoteOperation.REVISION and completed.returncode == 0:
                for line in stdout.splitlines():
                    if line.startswith("Revision: "):
                        revision = line.split(":", 1)[1].strip()
                        break
            return RemoteResult(node, operation, status, completed.returncode, stdout, stderr, revision)
        except subprocess.TimeoutExpired as exc:
            return RemoteResult(node, operation, RemoteStatus.FAILED, 124, redact(exc.stdout or ""), redact(exc.stderr or "command timeout"))
        except OSError as exc:
            return RemoteResult(node, operation, RemoteStatus.FAILED, 127, "", redact(str(exc)))
