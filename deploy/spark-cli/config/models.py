from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class EndpointConfig:
    host: str
    port: int
    protocol: str = "tcp"


@dataclass(frozen=True)
class NodeConfig:
    role: str
    host: str
    vlan: int | None = None
    secondary_hosts: tuple[str, ...] = ()
    ssh_user: str | None = None


@dataclass(frozen=True)
class ExternalServiceConfig:
    name: str
    host: str
    port: int = 443
    protocol: str = "https"
    required: bool = True


@dataclass(frozen=True)
class JumpServerConfig:
    enabled: bool = False
    host: str | None = None
    ssh_user: str | None = None


@dataclass(frozen=True)
class NetworkRuleConfig:
    rule_id: str
    source: str
    destination: str
    protocol: str = "tcp"
    ports: tuple[int, ...] = ()


@dataclass(frozen=True)
class NetworkConfig:
    management_cidr: str | None = None
    rules: tuple[NetworkRuleConfig, ...] = ()


@dataclass(frozen=True)
class RuntimeConfig:
    install_root: str = "/opt/spark"
    state_root: str = "/var/lib/spark-manager"


@dataclass(frozen=True)
class EnvironmentConfig:
    name: str
    mode: str = "online"
    schema_version: int = 1
    nodes: dict[str, NodeConfig] = field(default_factory=dict)
    jump_server: JumpServerConfig = field(default_factory=JumpServerConfig)
    external_services: dict[str, ExternalServiceConfig] = field(default_factory=dict)
    network: NetworkConfig = field(default_factory=NetworkConfig)
    runtime: RuntimeConfig = field(default_factory=RuntimeConfig)
