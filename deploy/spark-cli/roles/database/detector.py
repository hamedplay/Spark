from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Callable


class ComponentState(str, Enum):
    ABSENT = "ABSENT"
    PRESENT = "PRESENT"
    HEALTHY = "HEALTHY"
    UNHEALTHY = "UNHEALTHY"
    DEGRADED = "DEGRADED"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class DatabaseInstallationState:
    docker: ComponentState
    compose: ComponentState
    postgres: ComponentState
    auth: ComponentState
    rest: ComponentState
    realtime: ComponentState
    storage: ComponentState
    gateway: ComponentState
    studio: ComponentState
    supavisor: ComponentState
    schema: ComponentState
    install_root: str
    existing_postgres_data: bool = False


def _run(command: list[str], timeout: float = 2.0) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None


def _docker_state(which: Callable[[str], str | None]) -> ComponentState:
    if not which("docker"):
        return ComponentState.ABSENT
    result = _run(["docker", "info", "--format", "{{.ServerVersion}}"])
    if result is None:
        return ComponentState.UNKNOWN
    return ComponentState.HEALTHY if result.returncode == 0 else ComponentState.UNHEALTHY


def _compose_state(which: Callable[[str], str | None]) -> ComponentState:
    if not which("docker"):
        return ComponentState.ABSENT
    result = _run(["docker", "compose", "version", "--short"])
    if result is None:
        return ComponentState.UNKNOWN
    return ComponentState.HEALTHY if result.returncode == 0 else ComponentState.ABSENT


def _service_state(service: str, compose_file: Path) -> ComponentState:
    if not compose_file.is_file():
        return ComponentState.ABSENT
    result = _run(["docker", "compose", "-f", str(compose_file), "ps", "--status", "running", "--services"])
    if result is None:
        return ComponentState.UNKNOWN
    if result.returncode != 0:
        return ComponentState.UNHEALTHY
    running = {line.strip() for line in result.stdout.splitlines() if line.strip()}
    return ComponentState.HEALTHY if service in running else ComponentState.PRESENT


def detect_database_installation(
    install_root: str | Path = "/opt/spark/database/supabase",
    *,
    which: Callable[[str], str | None] = shutil.which,
) -> DatabaseInstallationState:
    root = Path(install_root)
    compose_file = root / "docker-compose.yml"
    data_candidates = (
        root / "volumes" / "db" / "data",
        root / "volumes" / "db",
        Path("/var/lib/postgresql/data"),
    )
    existing_data = any(path.exists() and any(path.iterdir()) if path.is_dir() else path.exists() for path in data_candidates)

    docker = _docker_state(which)
    compose = _compose_state(which)
    services = {
        "postgres": "db",
        "auth": "auth",
        "rest": "rest",
        "realtime": "realtime",
        "storage": "storage",
        "gateway": "kong",
        "studio": "studio",
        "supavisor": "supavisor",
    }
    detected = {
        name: _service_state(service, compose_file) if docker != ComponentState.ABSENT else ComponentState.ABSENT
        for name, service in services.items()
    }

    schema_marker = root / "spark" / "schema.version"
    schema = ComponentState.PRESENT if schema_marker.is_file() else ComponentState.ABSENT
    return DatabaseInstallationState(
        docker=docker,
        compose=compose,
        schema=schema,
        install_root=str(root),
        existing_postgres_data=existing_data,
        **detected,
    )
