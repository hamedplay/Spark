from __future__ import annotations

import os
from dataclasses import asdict

from adapters import AptAdapter, CommandRunner, SystemdAdapter
from config.models import DockerRuntimeConfig
from .detector import CONFLICTING_PACKAGES, DockerRuntimeDetector
from .models import DockerRuntimeState, RuntimeStatus

DOCKER_PACKAGES = (
    "docker-ce",
    "docker-ce-cli",
    "containerd.io",
    "docker-buildx-plugin",
    "docker-compose-plugin",
)


class DockerRuntimeManager:
    def __init__(
        self,
        *,
        runner: CommandRunner | None = None,
        apt: AptAdapter | None = None,
        systemd: SystemdAdapter | None = None,
        detector: DockerRuntimeDetector | None = None,
    ) -> None:
        self.runner = runner or CommandRunner()
        self.apt = apt or AptAdapter(self.runner)
        self.systemd = systemd or SystemdAdapter(self.runner)
        self.detector = detector or DockerRuntimeDetector(runner=self.runner, apt=self.apt, systemd=self.systemd)

    def detect(self) -> DockerRuntimeState:
        return self.detector.detect()

    def plan(self, policy: DockerRuntimeConfig) -> dict[str, object]:
        state = self.detect()
        actions: list[str] = []
        blocked: list[str] = []
        if state.status == RuntimeStatus.UNSUPPORTED:
            blocked.append(f"unsupported operating system: {state.os_id} {state.os_version}")
        if state.conflicting_packages and state.source != "docker-official-apt":
            if policy.replace_conflicting_packages:
                actions.append("replace conflicting distro/container runtime packages")
            else:
                blocked.append("conflicting packages require explicit replace_conflicting_packages=true")
        if not state.engine_installed:
            if policy.install_policy == "install-if-missing":
                actions.extend(("configure Docker official apt repository", "install Docker Engine"))
            else:
                blocked.append("Docker Engine is missing and install policy does not permit installation")
        if not state.compose_installed:
            actions.append("install Docker Compose plugin")
        if state.engine_installed and (not state.daemon_active or not state.daemon_healthy):
            actions.append("enable and start docker.service")
        if not state.engine_installed:
            actions.append("enable and start docker.service")
        return {
            "status": state.status.value,
            "actions": tuple(dict.fromkeys(actions)),
            "blocked": tuple(blocked),
            "conflicting_packages": state.conflicting_packages,
            "engine_version": state.engine_version,
            "compose_version": state.compose_version,
            "firewall_warnings": state.firewall_warnings,
        }

    def apply(self, policy: DockerRuntimeConfig) -> bool:
        before = self.detect()
        plan = self.plan(policy)
        if plan["blocked"]:
            raise RuntimeError("database runtime plan is blocked")
        if before.status == RuntimeStatus.HEALTHY and before.compose_installed:
            return False
        if os.geteuid() != 0:
            raise PermissionError("database.runtime must run as root when changes are required")
        if before.conflicting_packages and before.source != "docker-official-apt":
            self.apt.remove(tuple(p for p in before.conflicting_packages if p in CONFLICTING_PACKAGES))
        needs_repo = before.source != "docker-official-apt" or not before.engine_installed or not before.compose_installed
        if needs_repo:
            if not before.os_codename or not before.architecture:
                raise RuntimeError("cannot configure Docker repository without Ubuntu codename and architecture")
            self.apt.update()
            self.apt.configure_docker_repository(codename=before.os_codename, architecture=before.architecture)
            self.apt.update()
            packages = list(DOCKER_PACKAGES)
            if policy.version_policy == "exact":
                if not policy.version:
                    raise RuntimeError("exact Docker version policy requires runtime.docker.version")
                packages[0] = f"docker-ce={policy.version}"
                packages[1] = f"docker-ce-cli={policy.version}"
            self.apt.install(tuple(packages))
        self.systemd.enable_and_start("docker.service")
        after = self.detect()
        if after.status != RuntimeStatus.HEALTHY or not after.compose_installed:
            raise RuntimeError("Docker runtime verification failed after installation")
        return True
