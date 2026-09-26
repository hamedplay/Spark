from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class RuntimeStatus(str, Enum):
    ABSENT = "ABSENT"
    PARTIAL = "PARTIAL"
    HEALTHY = "HEALTHY"
    UNHEALTHY = "UNHEALTHY"
    CONFLICT = "CONFLICT"
    UNSUPPORTED = "UNSUPPORTED"


@dataclass(frozen=True)
class DockerRuntimeState:
    status: RuntimeStatus
    os_id: str
    os_version: str
    os_codename: str | None
    architecture: str | None
    engine_installed: bool
    engine_version: str | None
    daemon_active: bool
    daemon_healthy: bool
    compose_installed: bool
    compose_version: str | None
    source: str | None
    conflicting_packages: tuple[str, ...]
    socket_path: str | None
    firewall_warnings: tuple[str, ...] = ()
