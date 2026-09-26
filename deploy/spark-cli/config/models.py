from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class NodeConfig:
    role: str
    host: str
    vlan: int | None = None


@dataclass(frozen=True)
class NetworkConfig:
    management_cidr: str | None = None


@dataclass(frozen=True)
class RuntimeConfig:
    install_root: str = "/opt/spark"
    state_root: str = "/var/lib/spark-manager"


@dataclass(frozen=True)
class EnvironmentConfig:
    name: str
    mode: str = "online"
    nodes: dict[str, NodeConfig] = field(default_factory=dict)
    network: NetworkConfig = field(default_factory=NetworkConfig)
    runtime: RuntimeConfig = field(default_factory=RuntimeConfig)
