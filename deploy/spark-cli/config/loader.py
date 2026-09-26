from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import EnvironmentConfig, NetworkConfig, NodeConfig, RuntimeConfig
from .schema import validate_environment


def environment_from_mapping(data: dict[str, Any]) -> EnvironmentConfig:
    nodes = {
        name: NodeConfig(
            role=str(value.get("role", name)),
            host=str(value["host"]),
            vlan=value.get("vlan"),
        )
        for name, value in data.get("nodes", {}).items()
    }
    network = NetworkConfig(**data.get("network", {}))
    runtime = RuntimeConfig(**data.get("runtime", {}))
    return validate_environment(EnvironmentConfig(
        name=str(data.get("name", "")),
        mode=str(data.get("mode", "online")),
        nodes=nodes,
        network=network,
        runtime=runtime,
    ))


def load_environment(path: str | Path) -> EnvironmentConfig:
    path = Path(path)
    if path.suffix.lower() != ".json":
        raise ValueError("Phase 1 loader accepts JSON only; YAML architecture profiles are introduced in Phase 2")
    return environment_from_mapping(json.loads(path.read_text()))
