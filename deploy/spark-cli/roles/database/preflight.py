from __future__ import annotations

import os
import platform
import shutil
import socket
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from architecture.host_context import HostContext
from config.models import EnvironmentConfig

from .context import RoleGuardError, require_database_role
from .detector import ComponentState, DatabaseInstallationState, detect_database_installation


class PreflightStatus(str, Enum):
    PASS = "PASS"
    WARN = "WARN"
    FAIL = "FAIL"
    MISSING = "MISSING"
    NOT_FOUND = "NOT_FOUND"
    PRESENT = "PRESENT"
    NOT_TESTED = "NOT_TESTED"


@dataclass(frozen=True)
class PreflightCheck:
    name: str
    status: PreflightStatus
    message: str = ""


@dataclass(frozen=True)
class DatabasePreflightReport:
    checks: tuple[PreflightCheck, ...]
    installation: DatabaseInstallationState

    @property
    def ready(self) -> bool:
        return not any(check.status == PreflightStatus.FAIL for check in self.checks)

    @property
    def result(self) -> str:
        if not self.ready:
            return "NOT_READY"
        if any(check.status in {PreflightStatus.WARN, PreflightStatus.MISSING} for check in self.checks):
            return "READY_WITH_ACTIONS"
        return "READY"


def _memory_gib() -> float:
    try:
        values = {}
        for line in Path("/proc/meminfo").read_text().splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                values[key] = int(value.strip().split()[0])
        return values.get("MemTotal", 0) / 1024 / 1024
    except (OSError, ValueError, IndexError):
        return 0.0


def _disk_gib(path: str = "/") -> float:
    try:
        return shutil.disk_usage(path).free / 1024 / 1024 / 1024
    except OSError:
        return 0.0


def _filesystem_status(path: str | Path) -> tuple[PreflightStatus, str]:
    target = Path(path)
    probe = target
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    try:
        stats = os.statvfs(probe)
    except OSError as exc:
        return PreflightStatus.FAIL, f"cannot inspect {probe}: {exc}"
    read_only_flag = getattr(os, "ST_RDONLY", 1)
    if stats.f_flag & read_only_flag:
        return PreflightStatus.FAIL, f"filesystem for {probe} is read-only"
    return PreflightStatus.PASS, f"filesystem for {probe} is writable-capable"


def _port_available(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def _network_rule_present(environment: EnvironmentConfig) -> bool:
    return any(
        rule.source == "application"
        and rule.destination == "database"
        and rule.protocol.lower() == "tcp"
        and 5432 in rule.ports
        for rule in environment.network.rules
    )


def _runtime_status(state: ComponentState, *, missing_is_action: bool = True) -> PreflightStatus:
    if state == ComponentState.HEALTHY:
        return PreflightStatus.PASS
    if state == ComponentState.ABSENT:
        return PreflightStatus.MISSING if missing_is_action else PreflightStatus.FAIL
    if state in {ComponentState.UNHEALTHY, ComponentState.DEGRADED}:
        return PreflightStatus.FAIL
    return PreflightStatus.WARN


def run_database_preflight(
    environment: EnvironmentConfig,
    *,
    host: HostContext | None = None,
    install_root: str | Path = "/opt/spark/database/supabase",
    min_cpu: int = 2,
    recommended_cpu: int = 4,
    min_memory_gib: float = 4.0,
    recommended_memory_gib: float = 8.0,
    min_disk_gib: float = 40.0,
    recommended_disk_gib: float = 80.0,
) -> DatabasePreflightReport:
    checks: list[PreflightCheck] = []
    try:
        role_ctx = require_database_role(environment, host=host)
        checks.append(PreflightCheck("Role", PreflightStatus.PASS, role_ctx.host.detected_role or "database"))
    except RoleGuardError as exc:
        installation = detect_database_installation(install_root)
        checks.append(PreflightCheck("Role", PreflightStatus.FAIL, str(exc)))
        return DatabasePreflightReport(tuple(checks), installation)

    system = platform.system().lower()
    checks.append(PreflightCheck("OS", PreflightStatus.PASS if system == "linux" else PreflightStatus.FAIL, platform.platform()))

    cpu = os.cpu_count() or 0
    if cpu < min_cpu:
        checks.append(PreflightCheck("CPU", PreflightStatus.FAIL, f"{cpu} CPUs; minimum {min_cpu}"))
    elif cpu < recommended_cpu:
        checks.append(PreflightCheck("CPU", PreflightStatus.WARN, f"{cpu} CPUs; recommended {recommended_cpu}+"))
    else:
        checks.append(PreflightCheck("CPU", PreflightStatus.PASS, f"{cpu} CPUs"))

    memory = _memory_gib()
    if memory < min_memory_gib:
        checks.append(PreflightCheck("Memory", PreflightStatus.FAIL, f"{memory:.1f} GiB; minimum {min_memory_gib:.1f}"))
    elif memory < recommended_memory_gib:
        checks.append(PreflightCheck("Memory", PreflightStatus.WARN, f"{memory:.1f} GiB; recommended {recommended_memory_gib:.1f}+"))
    else:
        checks.append(PreflightCheck("Memory", PreflightStatus.PASS, f"{memory:.1f} GiB"))

    fs_status, fs_message = _filesystem_status(install_root)
    checks.append(PreflightCheck("Filesystem", fs_status, fs_message))

    disk = _disk_gib(str(Path(install_root).anchor or "/"))
    if disk < min_disk_gib:
        checks.append(PreflightCheck("Disk", PreflightStatus.FAIL, f"{disk:.1f} GiB free; minimum {min_disk_gib:.1f}"))
    elif disk < recommended_disk_gib:
        checks.append(PreflightCheck("Disk", PreflightStatus.WARN, f"{disk:.1f} GiB free; recommended {recommended_disk_gib:.1f}+"))
    else:
        checks.append(PreflightCheck("Disk", PreflightStatus.PASS, f"{disk:.1f} GiB free"))

    installation = detect_database_installation(install_root)
    checks.append(PreflightCheck("Docker", _runtime_status(installation.docker), installation.docker.value))
    checks.append(PreflightCheck("Compose", _runtime_status(installation.compose), installation.compose.value))

    occupied = [port for port in (5432, 8000, 3000) if not _port_available(port)]
    if occupied and installation.postgres == ComponentState.ABSENT:
        checks.append(PreflightCheck("Required Ports", PreflightStatus.FAIL, f"occupied: {', '.join(map(str, occupied))}"))
    elif occupied:
        checks.append(PreflightCheck("Required Ports", PreflightStatus.WARN, f"occupied by existing runtime: {', '.join(map(str, occupied))}"))
    else:
        checks.append(PreflightCheck("Required Ports", PreflightStatus.PASS, "5432, 8000, 3000 available"))

    existing = any(
        state not in {ComponentState.ABSENT, ComponentState.UNKNOWN}
        for state in (
            installation.postgres,
            installation.auth,
            installation.rest,
            installation.realtime,
            installation.storage,
            installation.gateway,
            installation.studio,
            installation.supavisor,
        )
    )
    checks.append(PreflightCheck("Existing Supabase", PreflightStatus.PRESENT if existing else PreflightStatus.NOT_FOUND, "detected" if existing else "not found"))
    checks.append(PreflightCheck("Existing PostgreSQL Data", PreflightStatus.PRESENT if installation.existing_postgres_data else PreflightStatus.NOT_FOUND, "detected" if installation.existing_postgres_data else "not found"))
    checks.append(PreflightCheck("Architecture Profile", PreflightStatus.PASS, environment.name))
    network_ready = _network_rule_present(environment)
    checks.append(PreflightCheck("Network", PreflightStatus.PASS if network_ready else PreflightStatus.WARN, "application -> database:5432 declared" if network_ready else "application -> database:5432 rule is not declared"))

    return DatabasePreflightReport(tuple(checks), installation)
