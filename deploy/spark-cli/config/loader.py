from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import (
    EnvironmentConfig,
    ExternalServiceConfig,
    JumpServerConfig,
    NetworkConfig,
    NetworkRuleConfig,
    NodeConfig,
    RuntimeConfig,
)
from .schema import validate_environment
from .yaml_loader import safe_load_profile

FORBIDDEN_SECRET_KEYS = {
    "db_password",
    "jwt_secret",
    "service_role_key",
    "smtp_password",
    "ssh_private_key",
    "anon_key",
}


def _assert_no_secrets(value: Any, path: str = "profile") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in FORBIDDEN_SECRET_KEYS or normalized.endswith("_password") or normalized.endswith("_secret") or normalized.endswith("_private_key"):
                raise ValueError(f"secrets are not allowed in architecture profiles: {path}.{key}")
            _assert_no_secrets(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _assert_no_secrets(child, f"{path}[{index}]")


def environment_from_mapping(data: dict[str, Any]) -> EnvironmentConfig:
    _assert_no_secrets(data)
    env = data.get("environment", {})
    name = env.get("name", data.get("name", ""))
    mode = env.get("mode", data.get("mode", "online"))
    schema_version = int(data.get("schema_version", 1))

    nodes = {
        name_key: NodeConfig(
            role=str(value.get("role", name_key)),
            host=str(value["host"]),
            vlan=value.get("vlan"),
            secondary_hosts=tuple(str(x) for x in value.get("secondary_hosts", ()) or ()),
            ssh_user=(str(value["ssh_user"]) if value.get("ssh_user") is not None else None),
        )
        for name_key, value in data.get("nodes", {}).items()
    }

    jump_data = data.get("jump_server", {}) or {}
    jump_server = JumpServerConfig(
        enabled=bool(jump_data.get("enabled", False)),
        host=(str(jump_data["host"]) if jump_data.get("host") is not None else None),
        ssh_user=(str(jump_data["ssh_user"]) if jump_data.get("ssh_user") is not None else None),
    )

    external_services = {
        key: ExternalServiceConfig(
            name=str(value.get("name", key)),
            host=str(value["host"]),
            port=int(value.get("port", 443)),
            protocol=str(value.get("protocol", "https")),
            required=bool(value.get("required", True)),
        )
        for key, value in data.get("external_services", {}).items()
    }

    network_data = data.get("network", {}) or {}
    raw_rules = network_data.get("rules", network_data.get("connectivity", ())) or ()
    rules = []
    for index, value in enumerate(raw_rules):
        rules.append(NetworkRuleConfig(
            rule_id=str(value.get("id", f"rule-{index + 1}")),
            source=str(value.get("source", "")),
            destination=str(value.get("destination", value.get("target", ""))),
            protocol=str(value.get("protocol", "tcp")),
            ports=tuple(int(p) for p in (value.get("ports") or ([value["port"]] if value.get("port") is not None else []))),
        ))
    network = NetworkConfig(
        management_cidr=network_data.get("management_cidr"),
        rules=tuple(rules),
    )
    runtime = RuntimeConfig(**(data.get("runtime", {}) or {}))
    return validate_environment(EnvironmentConfig(
        name=str(name),
        mode=str(mode),
        schema_version=schema_version,
        nodes=nodes,
        jump_server=jump_server,
        external_services=external_services,
        network=network,
        runtime=runtime,
    ))


def load_environment(path: str | Path) -> EnvironmentConfig:
    path = Path(path)
    suffix = path.suffix.lower()
    text = path.read_text()
    if suffix == ".json":
        data = json.loads(text)
    elif suffix in {".yaml", ".yml"}:
        data = safe_load_profile(text)
    else:
        raise ValueError(f"unsupported environment profile format: {suffix or '<none>'}")
    if not isinstance(data, dict):
        raise ValueError("environment profile root must be an object/mapping")
    return environment_from_mapping(data)
