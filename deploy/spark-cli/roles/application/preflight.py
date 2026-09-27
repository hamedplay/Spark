from __future__ import annotations

import os
import platform
import shutil
import socket
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from adapters.command import CommandRunner
from architecture.host_context import HostContext
from config.models import EnvironmentConfig
from .context import ApplicationRoleGuardError, require_application_role
from .detector import ApplicationInstallationState, detect_application_installation


class PreflightStatus(str, Enum):
    PASS = "PASS"
    WARN = "WARN"
    FAIL = "FAIL"
    MISSING = "MISSING"


@dataclass(frozen=True)
class PreflightCheck:
    name: str
    status: PreflightStatus
    message: str = ""


@dataclass(frozen=True)
class ApplicationPreflightReport:
    checks: tuple[PreflightCheck, ...]
    installation: ApplicationInstallationState

    @property
    def ready(self) -> bool:
        return not any(c.status == PreflightStatus.FAIL for c in self.checks)

    @property
    def result(self) -> str:
        if not self.ready:
            return "NOT_READY"
        return "READY_WITH_ACTIONS" if any(c.status in {PreflightStatus.WARN, PreflightStatus.MISSING} for c in self.checks) else "READY"


def _tcp(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _memory_gib() -> float:
    try:
        values = {}
        for line in Path("/proc/meminfo").read_text().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                values[k] = int(v.strip().split()[0])
        return values.get("MemTotal", 0) / 1024 / 1024
    except Exception:
        return 0.0


def _node(environment: EnvironmentConfig, role: str):
    for _, node in environment.nodes.items():
        if node.role == role:
            return node
    return None


def run_application_preflight(environment: EnvironmentConfig, *, host: HostContext | None = None, runner: CommandRunner | None = None) -> ApplicationPreflightReport:
    checks: list[PreflightCheck] = []
    runner = runner or CommandRunner()
    app = environment.application
    installation = detect_application_installation(app.source.releases_root, app.source.current_link, app.runtime_env_file)
    try:
        ctx = require_application_role(environment, host=host)
        checks.append(PreflightCheck("Role", PreflightStatus.PASS, ctx.host.detected_role or "application"))
    except ApplicationRoleGuardError as exc:
        checks.append(PreflightCheck("Role", PreflightStatus.FAIL, str(exc)))
        return ApplicationPreflightReport(tuple(checks), installation)

    checks.append(PreflightCheck("OS", PreflightStatus.PASS if platform.system().lower() == "linux" else PreflightStatus.FAIL, platform.platform()))
    cpu = os.cpu_count() or 0
    checks.append(PreflightCheck("CPU", PreflightStatus.PASS if cpu >= 2 else PreflightStatus.FAIL, f"{cpu} CPUs"))
    mem = _memory_gib()
    checks.append(PreflightCheck("Memory", PreflightStatus.PASS if mem >= 4 else PreflightStatus.FAIL, f"{mem:.1f} GiB"))
    disk = shutil.disk_usage("/").free / 1024 / 1024 / 1024
    checks.append(PreflightCheck("Disk", PreflightStatus.PASS if disk >= 20 else PreflightStatus.FAIL, f"{disk:.1f} GiB free"))

    docker = runner.run(("docker", "info"), timeout=10)
    checks.append(PreflightCheck("Docker", PreflightStatus.PASS if docker.returncode == 0 else PreflightStatus.MISSING, "HEALTHY" if docker.returncode == 0 else "MISSING/UNAVAILABLE"))
    node = runner.run((app.node_command, "--version"), timeout=10)
    checks.append(PreflightCheck("Node Runtime", PreflightStatus.PASS if node.returncode == 0 else PreflightStatus.MISSING, node.stdout.strip() if node.returncode == 0 else "MISSING"))
    git = runner.run(("git", "--version"), timeout=10)
    checks.append(PreflightCheck("Git", PreflightStatus.PASS if git.returncode == 0 else PreflightStatus.FAIL, git.stdout.strip() if git.returncode == 0 else "MISSING"))

    db = _node(environment, "database")
    if db is None:
        checks.append(PreflightCheck("Database", PreflightStatus.FAIL, "database node missing from profile"))
    else:
        checks.append(PreflightCheck("Database", PreflightStatus.PASS if _tcp(db.host, 5432) else PreflightStatus.FAIL, f"{db.host}:5432"))
        checks.append(PreflightCheck("Supabase API", PreflightStatus.PASS if _tcp(db.host, 8000) else PreflightStatus.FAIL, f"{db.host}:8000"))

    for key, svc in sorted(environment.external_services.items()):
        status = PreflightStatus.PASS if _tcp(svc.host, svc.port) else (PreflightStatus.FAIL if svc.required else PreflightStatus.WARN)
        checks.append(PreflightCheck(f"External:{key}", status, f"{svc.host}:{svc.port}"))

    return ApplicationPreflightReport(tuple(checks), installation)
