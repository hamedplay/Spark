from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from config.loader import load_environment
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


def architecture_show() -> ControllerResult:
    path, config = _load()
    host = detect_host_context(config)
    return ControllerResult("Architecture Overview", tuple([f"Profile: {path}", "", *render_architecture_overview(config, host)]))


def architecture_profile() -> ControllerResult:
    path, config = _load()
    lines = [
        f"Profile: {path}",
        f"Schema version: {config.schema_version}",
        f"Environment: {config.name}",
        f"Mode: {config.mode}",
        f"Nodes: {len(config.nodes)}",
        f"External services: {len(config.external_services)}",
        f"Network rules: {len(config.network.rules)}",
        "Secrets: forbidden by loader policy",
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
    lines = [
        f"Profile: {path}",
        f"Current role: {host.detected_role or 'UNKNOWN'}",
        "",
    ]
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
        lines.extend([
            item.role.replace("_", " ").title(),
            f"  Profile       {item.profile}",
            f"  Network       {item.network}",
            f"  Provisioning  {item.provisioning}",
            "",
        ])
    return ControllerResult("Deployment Status", tuple(lines))


def run_action(action_id: str) -> ControllerResult:
    handlers = {
        "architecture-overview": architecture_show,
        "architecture-profile": architecture_profile,
        "architecture-validate": architecture_validate,
        "architecture-network": architecture_network_check,
        "architecture-status": architecture_status,
    }
    if action_id not in handlers:
        return ControllerResult("Architecture", (f"Unknown architecture action: {action_id}",), False)
    try:
        return handlers[action_id]()
    except Exception as exc:
        return ControllerResult("Architecture", (f"ERROR: {exc}",), False)
