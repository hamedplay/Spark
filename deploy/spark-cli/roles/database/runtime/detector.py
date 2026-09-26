from __future__ import annotations

import platform
import shutil
from pathlib import Path

from adapters import AptAdapter, CommandRunner, DockerAdapter, SystemdAdapter
from .firewall import detect_firewall_warnings
from .models import DockerRuntimeState, RuntimeStatus

SUPPORTED_UBUNTU = {"22.04", "24.04", "26.04"}
CONFLICTING_PACKAGES = (
    "docker.io",
    "docker-compose",
    "docker-compose-v2",
    "docker-doc",
    "docker-buildx",
    "podman-docker",
    "containerd",
    "runc",
)


def _os_release(path: str | Path = "/etc/os-release") -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        for raw in Path(path).read_text().splitlines():
            if "=" not in raw:
                continue
            key, value = raw.split("=", 1)
            values[key] = value.strip().strip('"')
    except OSError:
        pass
    return values


class DockerRuntimeDetector:
    def __init__(
        self,
        *,
        runner: CommandRunner | None = None,
        apt: AptAdapter | None = None,
        systemd: SystemdAdapter | None = None,
        docker: DockerAdapter | None = None,
        os_release_path: str | Path = "/etc/os-release",
    ) -> None:
        self.runner = runner or CommandRunner()
        self.apt = apt or AptAdapter(self.runner)
        self.systemd = systemd or SystemdAdapter(self.runner)
        self.docker = docker or DockerAdapter(self.runner)
        self.os_release_path = os_release_path

    def detect(self) -> DockerRuntimeState:
        os_data = _os_release(self.os_release_path)
        os_id = os_data.get("ID", "unknown")
        version = os_data.get("VERSION_ID", "unknown")
        codename = os_data.get("UBUNTU_CODENAME") or os_data.get("VERSION_CODENAME")
        arch_result = self.runner.run(("dpkg", "--print-architecture"))
        architecture = arch_result.stdout.strip() if arch_result.returncode == 0 else platform.machine() or None
        conflicts = self.apt.installed_conflicts(CONFLICTING_PACKAGES)
        engine_installed = shutil.which("docker") is not None
        engine_version = self.docker.engine_version() if engine_installed else None
        compose_version = self.docker.compose_version() if engine_installed else None
        compose_installed = bool(compose_version)
        daemon_active = self.systemd.is_active("docker.service") if engine_installed else False
        daemon_healthy = self.docker.daemon_healthy() if engine_installed and daemon_active else False
        socket = "/var/run/docker.sock" if Path("/var/run/docker.sock").exists() else None
        source = None
        if self.apt.is_installed("docker-ce"):
            source = "docker-official-apt"
        elif engine_installed:
            source = "other"

        if os_id != "ubuntu" or version not in SUPPORTED_UBUNTU:
            status = RuntimeStatus.UNSUPPORTED
        elif conflicts:
            status = RuntimeStatus.CONFLICT
        elif not engine_installed and not compose_installed:
            status = RuntimeStatus.ABSENT
        elif engine_installed and compose_installed and daemon_active and daemon_healthy:
            status = RuntimeStatus.HEALTHY
        elif engine_installed and (not daemon_active or not daemon_healthy):
            status = RuntimeStatus.UNHEALTHY
        else:
            status = RuntimeStatus.PARTIAL

        return DockerRuntimeState(
            status=status,
            os_id=os_id,
            os_version=version,
            os_codename=codename,
            architecture=architecture,
            engine_installed=engine_installed,
            engine_version=engine_version,
            daemon_active=daemon_active,
            daemon_healthy=daemon_healthy,
            compose_installed=compose_installed,
            compose_version=compose_version,
            source=source,
            conflicting_packages=conflicts,
            socket_path=socket,
            firewall_warnings=detect_firewall_warnings(self.runner),
        )
