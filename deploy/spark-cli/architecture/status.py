from __future__ import annotations

from dataclasses import dataclass

from config.models import EnvironmentConfig
from .connectivity import ConnectivityCheck, ConnectivityStatus


@dataclass(frozen=True)
class RoleReadiness:
    role: str
    profile: str
    network: str
    provisioning: str = "NOT_STARTED"


def _network_state(role: str, checks: list[ConnectivityCheck]) -> str:
    relevant = [check for check in checks if check.source == role]
    if not relevant:
        return "NOT_APPLICABLE"
    statuses = {check.status for check in relevant}
    if ConnectivityStatus.FAIL in statuses:
        return "FAIL"
    if statuses == {ConnectivityStatus.PASS}:
        return "PASS"
    if ConnectivityStatus.PASS in statuses:
        return "PARTIAL"
    if ConnectivityStatus.NOT_TESTED in statuses:
        return "NOT_TESTED"
    return "NOT_APPLICABLE"


def deployment_readiness(config: EnvironmentConfig, checks: list[ConnectivityCheck]) -> list[RoleReadiness]:
    result: list[RoleReadiness] = []
    for role in ("reverse_proxy", "application", "database"):
        configured = any(node.role == role for node in config.nodes.values())
        result.append(RoleReadiness(
            role=role,
            profile="PASS" if configured else "FAIL",
            network=_network_state(role, checks),
        ))
    return result
