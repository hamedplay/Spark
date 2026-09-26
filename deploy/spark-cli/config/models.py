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
class DockerRuntimeConfig:
    install_policy: str = "install-if-missing"
    replace_conflicting_packages: bool = False
    version_policy: str = "compatible-stable"
    version: str | None = None


@dataclass(frozen=True)
class RuntimeConfig:
    install_root: str = "/opt/spark"
    state_root: str = "/var/lib/spark-manager"
    docker: DockerRuntimeConfig = field(default_factory=DockerRuntimeConfig)


@dataclass(frozen=True)
class SupabaseCapabilitiesConfig:
    auth: bool = True
    rest: bool = True
    realtime: bool = True
    storage: bool = True
    gateway: bool = True
    studio: bool = True
    pooler: bool = True
    meta: bool = True
    imgproxy: bool = True


@dataclass(frozen=True)
class SupabasePackageConfig:
    release: str = "self-hosted/v0.8.1"
    source_url: str = "https://github.com/supabase/supabase.git"
    destination: str = "/opt/spark/database/supabase"
    capabilities: SupabaseCapabilitiesConfig = field(default_factory=SupabaseCapabilitiesConfig)


@dataclass(frozen=True)
class DatabaseComposeConfig:
    project_name: str = "spark-supabase"


@dataclass(frozen=True)
class PostgresStartupConfig:
    normal_timeout_seconds: int = 120
    initialization_timeout_seconds: int = 600


@dataclass(frozen=True)
class ServiceRetryConfig:
    attempts: int = 3
    delay_seconds: int = 10


@dataclass(frozen=True)
class DatabaseStartupConfig:
    postgres: PostgresStartupConfig = field(default_factory=PostgresStartupConfig)
    service_retry: ServiceRetryConfig = field(default_factory=ServiceRetryConfig)
    supabase_timeout_seconds: int = 300
    image_pull_timeout_seconds: int = 900


@dataclass(frozen=True)
class DatabaseConfig:
    supabase: SupabasePackageConfig = field(default_factory=SupabasePackageConfig)
    secret_file: str = "/etc/spark-manager/secrets/database.env"
    compose: DatabaseComposeConfig = field(default_factory=DatabaseComposeConfig)
    startup: DatabaseStartupConfig = field(default_factory=DatabaseStartupConfig)


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
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
