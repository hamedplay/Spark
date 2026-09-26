from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class ImageReadiness(str, Enum):
    READY = "READY"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"


class ComponentState(str, Enum):
    ABSENT = "ABSENT"
    CREATED = "CREATED"
    STARTING = "STARTING"
    HEALTHY = "HEALTHY"
    UNHEALTHY = "UNHEALTHY"
    STOPPED = "STOPPED"
    DATA_PRESENT = "DATA_PRESENT"
    UNKNOWN = "UNKNOWN"


class AggregateState(str, Enum):
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    UNHEALTHY = "UNHEALTHY"
    PARTIAL = "PARTIAL"
    STOPPED = "STOPPED"


class Capability(str, Enum):
    DB = "database"
    AUTH = "auth"
    REST = "rest"
    REALTIME = "realtime"
    STORAGE = "storage"
    GATEWAY = "gateway"
    STUDIO = "studio"
    POOLER = "pooler"
    META = "meta"
    IMGPROXY = "imgproxy"


@dataclass(frozen=True)
class RequiredImage:
    service: str
    reference: str
    present: bool
    image_id: str | None


@dataclass(frozen=True)
class PostgresRuntimeState:
    state: ComponentState
    service_name: str
    container_id: str | None
    container_state: str | None
    docker_health: str | None
    data_present: bool
    data_version: str | None
    data_compatible: bool
    pg_isready: bool | None = None
    sql_probe: bool | None = None


@dataclass(frozen=True)
class ServiceRuntimeState:
    capability: Capability
    service_name: str
    container_id: str | None
    state: ComponentState
    docker_health: str | None
    endpoint_ready: bool | None
    required: bool = True
