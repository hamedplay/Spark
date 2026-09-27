from __future__ import annotations

import socket
from dataclasses import dataclass

from architecture.host_context import HostContext
from config.models import EnvironmentConfig, FullNetworkRuleConfig


@dataclass(frozen=True)
class NetworkCheckpoint:
    rule_id: str
    status: str
    source: str
    destination: str
    protocol: str
    ports: tuple[int, ...]
    port_ranges: tuple[str, ...]
    message: str


def _node_for_role(environment: EnvironmentConfig, role: str):
    for node in environment.nodes.values():
        if node.role == role:
            return node
    return None


def _destination_host(environment: EnvironmentConfig, ref: str) -> str | None:
    if ref in environment.nodes:
        return environment.nodes[ref].host
    node = _node_for_role(environment, ref)
    if node:
        return node.host
    if ref in environment.external_services:
        return environment.external_services[ref].host
    return None


def _source_is_local(environment: EnvironmentConfig, host: HostContext, ref: str) -> bool:
    if ref in {"internet", "clients"}:
        return False
    if ref in environment.nodes:
        node = environment.nodes[ref]
        return node.host in host.addresses or any(item in host.addresses for item in node.secondary_hosts)
    node = _node_for_role(environment, ref)
    if node:
        return node.host in host.addresses or any(item in host.addresses for item in node.secondary_hosts)
    return False


def _tcp(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=2):
            return True
    except OSError:
        return False


def evaluate_network_rule(environment: EnvironmentConfig, host: HostContext, rule: FullNetworkRuleConfig) -> NetworkCheckpoint:
    base = dict(rule_id=rule.rule_id, source=rule.source, destination=rule.destination, protocol=rule.protocol, ports=rule.ports, port_ranges=rule.port_ranges)
    if rule.verification in {"GUIDED", "MANUAL"}:
        return NetworkCheckpoint(**base, status="WAITING_FOR_OPERATOR", message=f"{rule.verification}: verify firewall/network rule externally")
    if rule.protocol != "tcp":
        return NetworkCheckpoint(**base, status="WAITING_FOR_OPERATOR", message="UDP/range verification is guided; no false TCP substitute is used")
    if not _source_is_local(environment, host, rule.source):
        return NetworkCheckpoint(**base, status="WAITING_FOR_REMOTE_NODE", message="AUTO_VERIFY must run from the configured source node")
    destination = _destination_host(environment, rule.destination)
    if not destination:
        return NetworkCheckpoint(**base, status="UNRESOLVED", message="destination host cannot be resolved from profile")
    failed = [port for port in rule.ports if not _tcp(destination, port)]
    if failed:
        return NetworkCheckpoint(**base, status="FAILED", message="unreachable TCP ports: " + ",".join(str(port) for port in failed))
    return NetworkCheckpoint(**base, status="PASS", message="all configured TCP ports reachable from this source node")


def evaluate_network(environment: EnvironmentConfig, host: HostContext) -> tuple[NetworkCheckpoint, ...]:
    return tuple(evaluate_network_rule(environment, host, rule) for rule in environment.full_environment.network_rules)
