from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import (
    DatabaseConfig,
    DockerRuntimeConfig,
    EnvironmentConfig,
    ExternalServiceConfig,
    JumpServerConfig,
    NetworkConfig,
    NetworkRuleConfig,
    NodeConfig,
    RuntimeConfig,
    SupabasePackageConfig,
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
    "supabase_secret_key",
    "jwt_private_key",
    "jwt_public_jwks",
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

    runtime_data = data.get("runtime", {}) or {}
    docker_data = runtime_data.get("docker", {}) or {}
    runtime = RuntimeConfig(
        install_root=str(runtime_data.get("install_root", "/opt/spark")),
        state_root=str(runtime_data.get("state_root", "/var/lib/spark-manager")),
        docker=DockerRuntimeConfig(
            install_policy=str(docker_data.get("install_policy", "install-if-missing")),
            replace_conflicting_packages=bool(docker_data.get("replace_conflicting_packages", False)),
            version_policy=str(docker_data.get("version_policy", "compatible-stable")),
            version=(str(docker_data["version"]) if docker_data.get("version") is not None else None),
        ),
    )

    database_data = data.get("database", {}) or {}
    supabase_data = database_data.get("supabase", {}) or {}
    database = DatabaseConfig(
        supabase=SupabasePackageConfig(
            release=str(supabase_data.get("release", "self-hosted/v0.8.1")),
            source_url=str(supabase_data.get("source_url", "https://github.com/supabase/supabase.git")),
            destination=str(supabase_data.get("destination", "/opt/spark/database/supabase")),
        ),
        secret_file=str(database_data.get("secret_file", "/etc/spark-manager/secrets/database.env")),
    )
    return validate_environment(EnvironmentConfig(
        name=str(name),
        mode=str(mode),
        schema_version=schema_version,
        nodes=nodes,
        jump_server=jump_server,
        external_services=external_services,
        network=network,
        runtime=runtime,
        database=database,
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
