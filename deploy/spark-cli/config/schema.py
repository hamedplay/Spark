from __future__ import annotations

import ipaddress
import re
from pathlib import Path

from .models import EnvironmentConfig

HOST_RE = re.compile(r"^(?=.{1,253}$)(?!-)[A-Za-z0-9.-]+(?<!-)$")
PROJECT_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$")
SCHEMA_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
REQUIRED_ROLES = {"reverse_proxy", "application", "database"}
VALID_PROTOCOLS = {"tcp", "https", "http"}
PINNED_RELEASE_RE = re.compile(r"^self-hosted/v\d+\.\d+\.\d+$")
VALID_DOCKER_INSTALL_POLICIES = {"install-if-missing", "manual"}
VALID_DOCKER_VERSION_POLICIES = {"compatible-stable", "exact"}


def _valid_host(value: str) -> bool:
    value = value.strip()
    if not value:
        return False
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return bool(HOST_RE.fullmatch(value)) and ".." not in value


def validate_environment(config: EnvironmentConfig) -> EnvironmentConfig:
    if config.schema_version != 1:
        raise ValueError(f"unsupported architecture schema_version: {config.schema_version}")
    if not config.name.strip():
        raise ValueError("environment name is required")
    if config.mode not in {"online", "airgap"}:
        raise ValueError(f"unsupported environment mode: {config.mode}")

    roles: set[str] = set()
    seen_hosts: dict[str, str] = {}
    for key, node in config.nodes.items():
        if not key.strip() or not node.role.strip() or not _valid_host(node.host):
            raise ValueError(f"invalid node definition: {key!r}")
        if node.vlan is not None and not (1 <= int(node.vlan) <= 4094):
            raise ValueError(f"invalid VLAN for {key}: {node.vlan}")
        if node.role in roles:
            raise ValueError(f"duplicate node role: {node.role}")
        roles.add(node.role)
        for host in (node.host, *node.secondary_hosts):
            if not _valid_host(host):
                raise ValueError(f"invalid host for {key}: {host}")
            if host in seen_hosts:
                raise ValueError(f"duplicate host {host} used by {seen_hosts[host]} and {key}")
            seen_hosts[host] = key

    missing = REQUIRED_ROLES - roles
    if missing:
        raise ValueError(f"missing required architecture roles: {', '.join(sorted(missing))}")

    if config.jump_server.enabled and config.jump_server.host is not None and not _valid_host(config.jump_server.host):
        raise ValueError(f"invalid jump server host: {config.jump_server.host}")

    for key, service in config.external_services.items():
        if not key.strip() or not _valid_host(service.host):
            raise ValueError(f"invalid external service: {key!r}")
        if not (1 <= service.port <= 65535):
            raise ValueError(f"invalid external service port for {key}: {service.port}")
        if service.protocol not in VALID_PROTOCOLS:
            raise ValueError(f"unsupported external service protocol for {key}: {service.protocol}")

    known_refs = set(config.nodes) | roles | set(config.external_services) | {"internet"}
    seen_rule_ids: set[str] = set()
    seen_signatures: set[tuple[str, str, str, tuple[int, ...]]] = set()
    for rule in config.network.rules:
        if not rule.rule_id.strip() or rule.rule_id in seen_rule_ids:
            raise ValueError(f"duplicate or empty network rule id: {rule.rule_id!r}")
        seen_rule_ids.add(rule.rule_id)
        if rule.source not in known_refs or rule.destination not in known_refs:
            raise ValueError(f"network rule {rule.rule_id} references an unknown source/destination")
        if rule.protocol not in VALID_PROTOCOLS:
            raise ValueError(f"unsupported protocol in network rule {rule.rule_id}: {rule.protocol}")
        if not rule.ports or any(port < 1 or port > 65535 for port in rule.ports):
            raise ValueError(f"invalid ports in network rule {rule.rule_id}")
        signature = (rule.source, rule.destination, rule.protocol, tuple(sorted(rule.ports)))
        if signature in seen_signatures:
            raise ValueError(f"duplicate network rule definition: {rule.rule_id}")
        seen_signatures.add(signature)

    docker = config.runtime.docker
    if docker.install_policy not in VALID_DOCKER_INSTALL_POLICIES:
        raise ValueError(f"unsupported runtime.docker.install_policy: {docker.install_policy}")
    if docker.version_policy not in VALID_DOCKER_VERSION_POLICIES:
        raise ValueError(f"unsupported runtime.docker.version_policy: {docker.version_policy}")
    if docker.version_policy == "exact" and not docker.version:
        raise ValueError("runtime.docker.version is required when version_policy=exact")

    package = config.database.supabase
    if not PINNED_RELEASE_RE.fullmatch(package.release):
        raise ValueError("database.supabase.release must be an explicit self-hosted/vX.Y.Z release")
    if not package.source_url.startswith("https://"):
        raise ValueError("database.supabase.source_url must use https")
    if not Path(package.destination).is_absolute():
        raise ValueError("database.supabase.destination must be an absolute path")
    if not Path(config.database.secret_file).is_absolute():
        raise ValueError("database.secret_file must be an absolute path")
    if not PROJECT_RE.fullmatch(config.database.compose.project_name):
        raise ValueError("database.compose.project_name contains invalid characters")

    owned = config.database.schema.owned_schemas
    if len(set(owned)) != len(owned):
        raise ValueError("database.schema.owned_schemas contains duplicates")
    if any(not SCHEMA_NAME_RE.fullmatch(value) for value in owned):
        raise ValueError("database.schema.owned_schemas contains an invalid schema name")

    startup = config.database.startup
    if startup.postgres.normal_timeout_seconds < 1 or startup.postgres.initialization_timeout_seconds < 1:
        raise ValueError("database.startup.postgres timeouts must be positive")
    if startup.postgres.initialization_timeout_seconds < startup.postgres.normal_timeout_seconds:
        raise ValueError("database.startup.postgres initialization timeout must be >= normal timeout")
    if startup.service_retry.attempts < 1 or startup.service_retry.delay_seconds < 0:
        raise ValueError("database.startup.service_retry values are invalid")
    if startup.supabase_timeout_seconds < 1 or startup.image_pull_timeout_seconds < 1:
        raise ValueError("database startup timeouts must be positive")

    return config
