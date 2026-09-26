from __future__ import annotations

import socket
from dataclasses import dataclass
from enum import Enum

from config.models import EnvironmentConfig, NetworkRuleConfig
from .host_context import HostContext


class ConnectivityStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    NOT_TESTED = "NOT_TESTED"
    NOT_APPLICABLE = "NOT_APPLICABLE"


@dataclass(frozen=True)
class ConnectivityCheck:
    rule_id: str
    source: str
    destination: str
    port: int
    status: ConnectivityStatus
    message: str


def _node_for_ref(config: EnvironmentConfig, ref: str):
    if ref in config.nodes:
        return config.nodes[ref]
    for node in config.nodes.values():
        if node.role == ref:
            return node
    return None


def _destination_host(config: EnvironmentConfig, ref: str) -> str | None:
    node = _node_for_ref(config, ref)
    if node is not None:
        return node.host
    service = config.external_services.get(ref)
    if service is not None:
        return service.host
    return None


def _source_role(config: EnvironmentConfig, rule: NetworkRuleConfig) -> str | None:
    node = _node_for_ref(config, rule.source)
    return node.role if node is not None else None


def check_connectivity(
    config: EnvironmentConfig,
    host_context: HostContext,
    *,
    timeout: float = 1.5,
) -> list[ConnectivityCheck]:
    checks: list[ConnectivityCheck] = []
    for rule in config.network.rules:
        source_role = _source_role(config, rule)
        for port in rule.ports:
            if source_role is None:
                checks.append(ConnectivityCheck(rule.rule_id, rule.source, rule.destination, port, ConnectivityStatus.NOT_APPLICABLE, "rule source is not a managed Spark node"))
                continue
            if host_context.detected_role != source_role:
                checks.append(ConnectivityCheck(rule.rule_id, rule.source, rule.destination, port, ConnectivityStatus.NOT_TESTED, f"requires execution from {source_role}; current role is {host_context.detected_role or 'UNKNOWN'}"))
                continue
            destination = _destination_host(config, rule.destination)
            if destination is None:
                checks.append(ConnectivityCheck(rule.rule_id, rule.source, rule.destination, port, ConnectivityStatus.NOT_TESTED, "destination cannot be resolved to a concrete profile endpoint"))
                continue
            try:
                with socket.create_connection((destination, port), timeout=timeout):
                    pass
            except OSError as exc:
                checks.append(ConnectivityCheck(rule.rule_id, rule.source, rule.destination, port, ConnectivityStatus.FAIL, str(exc)))
            else:
                checks.append(ConnectivityCheck(rule.rule_id, rule.source, rule.destination, port, ConnectivityStatus.PASS, f"connected to {destination}:{port}"))
    return checks
