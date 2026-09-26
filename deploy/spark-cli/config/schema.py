from __future__ import annotations

from .models import EnvironmentConfig


def validate_environment(config: EnvironmentConfig) -> EnvironmentConfig:
    if not config.name.strip():
        raise ValueError("environment name is required")
    if config.mode not in {"online", "airgap"}:
        raise ValueError(f"unsupported environment mode: {config.mode}")
    for key, node in config.nodes.items():
        if not key.strip() or not node.role.strip() or not node.host.strip():
            raise ValueError(f"invalid node definition: {key!r}")
        if node.vlan is not None and not (1 <= node.vlan <= 4094):
            raise ValueError(f"invalid VLAN for {key}: {node.vlan}")
    return config
