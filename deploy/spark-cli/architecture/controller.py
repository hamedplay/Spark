from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from config.loader import load_environment
from core.context import ExecutionContext
from core.state import StateStore
from roles.application.workflow import build_application_full_workflow
from roles.database.workflow import build_database_core_install_workflow
from roles.environment import FullEnvironmentOrchestrator
from roles.reverse_proxy.workflow import build_reverse_proxy_workflow
from .connectivity import check_connectivity
from .host_context import detect_host_context
from .renderer import render_architecture_overview
from .status import deployment_readiness
from .validator import validate_architecture

DEFAULT_PROFILE = Path("/etc/spark-manager/environments/production.yaml")


@dataclass(frozen=True)
class ControllerResult:
    title: str
    lines: tuple[str, ...]
    success: bool = True


def resolve_profile_path() -> Path:
    explicit = os.environ.get("SPARK_ENV_PROFILE")
    return Path(explicit) if explicit else DEFAULT_PROFILE


def _load():
    path = resolve_profile_path()
    if not path.is_file():
        raise FileNotFoundError(f"environment profile not found: {path}")
    return path, load_environment(path)


def _context(*, dry_run: bool = False, resume: bool = False) -> ExecutionContext:
    path, config = _load()
    host = detect_host_context(config)
    return ExecutionContext(
        environment=config.name,
        mode=config.mode,
        dry_run=dry_run,
        resume=resume,
        variables={"environment_profile": str(path), "host_context": host},
        state=StateStore(config.runtime.state_root + "/workflows"),
    )


def architecture_show() -> ControllerResult:
    path, config = _load()
    host = detect_host_context(config)
    return ControllerResult("Architecture Overview", tuple([f"Profile: {path}", "", *render_architecture_overview(config, host)]))


def architecture_profile() -> ControllerResult:
    path, config = _load()
    lines = [
        f"Profile: {path}", f"Schema version: {config.schema_version}", f"Environment: {config.name}", f"Mode: {config.mode}",
        f"Nodes: {len(config.nodes)}", f"External services: {len(config.external_services)}", f"Network rules: {len(config.network.rules)}",
        f"Full-environment network rules: {len(config.full_environment.network_rules)}", "Secrets: forbidden by loader policy",
    ]
    return ControllerResult("Environment Profile", tuple(lines))


def architecture_validate() -> ControllerResult:
    path, config = _load()
    report = validate_architecture(config)
    lines = [f"Profile: {path}", ""] + [f"{item.status.value:<14} {item.check}: {item.message}" for item in report.issues]
    return ControllerResult("Validate Architecture", tuple(lines), report.ok)


def architecture_network_check() -> ControllerResult:
    path, config = _load()
    host = detect_host_context(config)
    checks = check_connectivity(config, host)
    lines = [f"Profile: {path}", f"Current role: {host.detected_role or 'UNKNOWN'}", ""]
    if not checks:
        lines.append("NOT_APPLICABLE  No declarative network rules configured")
    for check in checks:
        lines.append(f"{check.status.value:<14} {check.rule_id}: {check.source} -> {check.destination}:{check.port} | {check.message}")
    success = not any(check.status.value == "FAIL" for check in checks)
    return ControllerResult("Network Connectivity", tuple(lines), success)


def architecture_status() -> ControllerResult:
    path, config = _load()
    host = detect_host_context(config)
    checks = check_connectivity(config, host)
    readiness = deployment_readiness(config, checks)
    lines = [f"Profile: {path}", f"Current role: {host.detected_role or 'UNKNOWN'}", "", "DEPLOYMENT READINESS", ""]
    for item in readiness:
        lines.extend([item.role.replace("_", " ").title(), f"  Profile       {item.profile}", f"  Network       {item.network}", f"  Provisioning  {item.provisioning}", ""])
    full = FullEnvironmentOrchestrator().status(_context())
    lines.extend(["FULL ENVIRONMENT", f"  Status        {full.status}"])
    for name, status in sorted(full.health.checks.items()):
        lines.append(f"  {name:<20} {status}")
    return ControllerResult("Deployment Status", tuple(lines))


def _render_workflow(title: str, workflow, ctx: ExecutionContext) -> ControllerResult:
    result = workflow.execute(ctx)
    lines = [f"Current role: {ctx.variables['host_context'].detected_role or 'UNKNOWN'}", f"Dry run: {'YES' if ctx.dry_run else 'NO'}", f"Resume: {'YES' if ctx.resume else 'NO'}", ""]
    for task_id, task in result.results.items():
        lines.append(f"{task.status.value:<12} {task_id}: {task.message}")
    return ControllerResult(title, tuple(lines), result.ok)


def install_database(*, dry_run: bool = False, resume: bool = False) -> ControllerResult:
    return _render_workflow("Install Database Core", build_database_core_install_workflow(), _context(dry_run=dry_run, resume=resume))


def install_application(*, dry_run: bool = False, resume: bool = False) -> ControllerResult:
    return _render_workflow("Install Application Server", build_application_full_workflow(), _context(dry_run=dry_run, resume=resume))


def install_reverse_proxy(*, dry_run: bool = False, resume: bool = False) -> ControllerResult:
    return _render_workflow("Install Reverse Proxy", build_reverse_proxy_workflow(), _context(dry_run=dry_run, resume=resume))


def _render_full(title: str, result) -> ControllerResult:
    lines = [f"Local role: {result.local_role or 'UNKNOWN'}", f"Local workflow: {result.local_workflow_status or 'NOT_RUN'}", f"Environment status: {result.status}", "", "COMPONENT HEALTH"]
    for name, status in sorted(result.health.checks.items()):
        lines.append(f"  {name:<22} {status}")
    lines.extend(["", "NETWORK CHECKPOINTS"])
    for item in result.network:
        ports = ",".join(str(v) for v in item.ports) or ",".join(item.port_ranges)
        lines.append(f"  {item.status:<23} {item.rule_id}: {item.source} -> {item.destination} {item.protocol}/{ports}")
    if result.remote_actions:
        lines.extend(["", "REMOTE/GUIDED ACTIONS"])
        lines.extend(f"  {value}" for value in result.remote_actions)
    return ControllerResult(title, tuple(lines), result.ok)


def install_full(*, dry_run: bool = False, resume: bool = False) -> ControllerResult:
    ctx = _context(dry_run=dry_run, resume=resume)
    return _render_full("Install Full Environment", FullEnvironmentOrchestrator().install(ctx))


def validate_environment() -> ControllerResult:
    return _render_full("Validate Environment", FullEnvironmentOrchestrator().status(_context()))


def repair_environment(*, dry_run: bool = False, resume: bool = True) -> ControllerResult:
    return _render_full("Repair Environment", FullEnvironmentOrchestrator().repair(_context(dry_run=dry_run, resume=resume)))


def run_action(action_id: str, *, dry_run: bool = False, resume: bool = False) -> ControllerResult:
    handlers = {
        "architecture-overview": lambda: architecture_show(),
        "architecture-profile": lambda: architecture_profile(),
        "architecture-validate": lambda: architecture_validate(),
        "architecture-network": lambda: architecture_network_check(),
        "architecture-status": lambda: architecture_status(),
        "architecture-install-database": lambda: install_database(dry_run=dry_run, resume=resume),
        "architecture-install-application": lambda: install_application(dry_run=dry_run, resume=resume),
        "architecture-install-proxy": lambda: install_reverse_proxy(dry_run=dry_run, resume=resume),
        "architecture-install-full": lambda: install_full(dry_run=dry_run, resume=resume),
        "architecture-resume": lambda: install_full(dry_run=dry_run, resume=True),
        "architecture-validate-environment": lambda: validate_environment(),
        "architecture-repair": lambda: repair_environment(dry_run=dry_run, resume=True),
    }
    if action_id not in handlers:
        return ControllerResult("Architecture", (f"Unknown architecture action: {action_id}",), False)
    try:
        return handlers[action_id]()
    except Exception as exc:
        return ControllerResult("Architecture", (f"ERROR: {exc}",), False)
