from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class RemoteOperation(str, Enum):
    REVISION = "revision"
    PROFILE = "profile"
    INSTALL = "install"
    STATUS = "status"
    VALIDATE = "validate"
    ROLE_HEALTH = "role-health"
    NETWORK = "network"
    REPAIR = "repair"


class RemoteStatus(str, Enum):
    READY = "READY"
    PASS = "PASS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    VERSION_MISMATCH = "VERSION_MISMATCH"
    REFUSED = "REFUSED"


@dataclass(frozen=True)
class RemoteNode:
    id: str
    role: str
    host: str
    ssh_user: str


@dataclass(frozen=True)
class RemoteResult:
    node: RemoteNode
    operation: RemoteOperation
    status: RemoteStatus
    returncode: int
    stdout: str = ""
    stderr: str = ""
    revision: str | None = None

    @property
    def ok(self) -> bool:
        return self.status in {RemoteStatus.READY, RemoteStatus.PASS, RemoteStatus.COMPLETED}


@dataclass(frozen=True)
class ProductionRunResult:
    status: str
    results: tuple[RemoteResult, ...] = ()
    checks: dict[str, str] = field(default_factory=dict)
    lines: tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return self.status == "READY"
